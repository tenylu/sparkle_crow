import { ChildProcess, exec, execFile, spawn } from 'child_process'
import {
  dataDir,
  logPath,
  mihomoCorePath,
  mihomoIpcPath,
  mihomoProfileWorkDir,
  mihomoTestDir,
  mihomoWorkConfigPath,
  mihomoWorkDir
} from '../utils/dirs'
import { generateProfile, getRuntimeConfig } from './factory'
import {
  getAppConfig,
  getControledMihomoConfig,
  getProfileConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import { app, dialog, ipcMain, net as electronNet } from 'electron'
import {
  startMihomoTraffic,
  startMihomoConnections,
  startMihomoLogs,
  startMihomoMemory,
  stopMihomoConnections,
  stopMihomoTraffic,
  stopMihomoLogs,
  stopMihomoMemory,
  patchMihomoConfig,
  mihomoGroups
} from './mihomoApi'
import { readFile, rm, writeFile } from 'fs/promises'
import { promisify } from 'util'
import { mainWindow } from '..'
import path from 'path'
import os from 'os'
import net from 'net'
import { createWriteStream, existsSync, accessSync, constants } from 'fs'
import { uploadRuntimeConfig } from '../resolve/gistApi'
import { startMonitor } from '../resolve/trafficMonitor'
import { disableSysProxy, triggerSysProxy } from '../sys/sysproxy'
import { getAxios } from './mihomoApi'
import { findAvailablePort } from '../resolve/server'

const ctlParam = process.platform === 'win32' ? '-ext-ctl-pipe' : '-ext-ctl-unix'

let setPublicDNSTimer: NodeJS.Timeout | null = null
let recoverDNSTimer: NodeJS.Timeout | null = null
let networkDetectionTimer: NodeJS.Timeout | null = null
let networkDownHandled = false

let child: ChildProcess
let retry = 10
let permissionGrantAttempted = false

export async function startCore(detached = false): Promise<Promise<void>[]> {
  const {
    core = 'mihomo',
    autoSetDNS = true,
    diffWorkDir = false,
    mihomoCpuPriority = 'PRIORITY_NORMAL',
    disableLoopbackDetector = false,
    disableEmbedCA = false,
    disableSystemCA = false,
    disableNftables = false,
    safePaths = []
  } = await getAppConfig()
  const { 'log-level': logLevel, 'mixed-port': configuredPort } = await getControledMihomoConfig()
  const { current } = await getProfileConfig()
  const { tun } = await getControledMihomoConfig()

  let corePath: string
  try {
    corePath = mihomoCorePath(core)
    // Check if core executable exists
    if (!existsSync(corePath)) {
      const errorMsg = `内核可执行文件不存在: ${corePath}\n请重新安装应用程序或检查内核文件是否完整。`
      console.error('[Manager]', errorMsg)
      await writeFile(logPath(), `[Manager]: ${errorMsg}\n`, { flag: 'a' })
      throw new Error(errorMsg)
    }
  } catch (error) {
    if (core === 'system') {
      await patchAppConfig({ core: 'mihomo' })
      return startCore(detached)
    }
    throw error
  }

  // Check if core is running first, and stop it if needed
  const isRunning = await isCoreRunning()
  if (isRunning) {
    await stopCore()
    // Wait for port to be released (including TIME_WAIT state)
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  // Check if the configured port is available
  // Only switch to a new port if:
  // 1. Port is actually in use by another process (not just TIME_WAIT)
  // 2. It's not our own process using it
  const actualPort = configuredPort || 7890
  const isPortAvailable = await new Promise<boolean>((resolve) => {
    const testServer = net.createServer()
    testServer.once('error', (err: any) => {
      // Check if error is EADDRINUSE (port in use) or other error
      if (err.code === 'EADDRINUSE') {
        // Port is in use, check if it's our own process
        resolve(false)
      } else {
        // Other error, assume port is not available
        resolve(false)
      }
    })
    testServer.once('listening', () => {
      testServer.close(() => resolve(true))
    })
    testServer.listen(actualPort, '127.0.0.1')
  })

  if (!isPortAvailable) {
    // Port might be in TIME_WAIT state, wait a bit more and check again
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const isPortAvailableRetry = await new Promise<boolean>((resolve) => {
      const testServer = net.createServer()
      testServer.once('error', () => resolve(false))
      testServer.once('listening', () => {
        testServer.close(() => resolve(true))
      })
      testServer.listen(actualPort, '127.0.0.1')
    })

    if (!isPortAvailableRetry) {
      // Port is still in use after waiting, check if it's another process
      // Only switch port if it's genuinely occupied by another process
      try {
        // Try to check if port is used by another process (not just TIME_WAIT)
        if (process.platform === 'darwin' || process.platform === 'linux') {
          try {
            const execPromise = promisify(exec)
            const { stdout } = await execPromise(`lsof -ti:${actualPort} 2>/dev/null || true`)
            const pids = stdout.trim().split('\n').filter(pid => pid && !isNaN(parseInt(pid)))
            if (pids.length > 0) {
              // Port is used by a process, check if it's our core process
              const corePath = mihomoCorePath(core)
              const { stdout: processInfo } = await execPromise(`ps -p ${pids.join(',')} -o command= 2>/dev/null || true`)
              if (processInfo.includes(corePath) || processInfo.includes('mihomo')) {
                // It's our own process, kill it and use the same port
                console.log(`[Manager] Port ${actualPort} is used by our own process, killing it`)
                for (const pidStr of pids) {
                  const pid = parseInt(pidStr)
                  if (!isNaN(pid)) {
                    try {
                      process.kill(pid, 'SIGTERM')
                    } catch {
                      // Process might not exist
                    }
                  }
                }
                await new Promise((resolve) => setTimeout(resolve, 1000))
                // After killing, try to use the same port (continue with normal flow)
              } else {
                // Port is used by another process, switch to a new port
                const availablePort = await findAvailablePort(actualPort)
                console.log(`[Manager] Port ${actualPort} is in use by another process, switching to port ${availablePort}`)
                await patchControledMihomoConfig({ 'mixed-port': availablePort })
                await writeFile(logPath(), `[Manager]: Port ${actualPort} is in use by another process, switched to port ${availablePort}\n`, {
                  flag: 'a'
                })
              }
            } else {
              // No process found, might be TIME_WAIT, wait more and use same port
              console.log(`[Manager] Port ${actualPort} appears unavailable but no process found, waiting...`)
              // Give the kernel a bit more time (for TIME_WAIT) and keep the same port
              await new Promise((resolve) => setTimeout(resolve, 3000))
            }
          } catch (error) {
            // lsof/ps might not be available, just switch port
            console.warn('[Manager] Could not determine port usage, keeping configured port:', error)
            await new Promise((resolve) => setTimeout(resolve, 3000))
          }
        } else {
          // Windows or other platform, just switch port if unavailable
          const availablePort = await findAvailablePort(actualPort)
          console.log(`[Manager] Port ${actualPort} is in use, switching to port ${availablePort}`)
          await patchControledMihomoConfig({ 'mixed-port': availablePort })
          await writeFile(logPath(), `[Manager]: Port ${actualPort} is in use, switched to port ${availablePort}\n`, {
            flag: 'a'
          })
        }
      } catch (error) {
        console.error('[Manager] Failed to find available port:', error)
        await writeFile(logPath(), `[Manager]: Failed to find available port: ${error}\n`, {
          flag: 'a'
        })
      }
    }
  }

  await generateProfile()
  await checkProfile()
  
  // Always clean up socket file before starting (even if not running)
  // This handles cases where previous instance crashed and left socket file
  const socketPath = mihomoIpcPath()
  if (existsSync(socketPath)) {
    console.log('[Manager] Found existing socket file, attempting cleanup')
    
    // Retry logic for socket cleanup
    let socketCleaned = false
    for (let retry = 0; retry < 5 && !socketCleaned; retry++) {
      try {
        // Try to kill any process using the socket
        try {
          const execPromise = promisify(exec)
          const { stdout } = await execPromise(`lsof -t "${socketPath}" 2>/dev/null || true`)
          const pids = stdout.trim().split('\n').filter(pid => pid && !isNaN(parseInt(pid)))
          if (pids.length > 0) {
            console.log(`[Manager] Found ${pids.length} process(es) using socket: ${pids.join(', ')}`)
            for (const pidStr of pids) {
              const pid = parseInt(pidStr)
              if (!isNaN(pid)) {
                try {
                  // Try SIGTERM first
                  process.kill(pid, 'SIGTERM')
                  console.log(`[Manager] Sent SIGTERM to PID ${pid}`)
                } catch {
                  // Process might not exist
                }
              }
            }
            // Wait for processes to terminate
            await new Promise((resolve) => setTimeout(resolve, 1000))
            
            // Check again if processes are still running
            const { stdout: stdout2 } = await execPromise(`lsof -t "${socketPath}" 2>/dev/null || true`)
            const remainingPids = stdout2.trim().split('\n').filter(pid => pid && !isNaN(parseInt(pid)))
            if (remainingPids.length > 0) {
              console.log(`[Manager] Processes still using socket, sending SIGKILL: ${remainingPids.join(', ')}`)
              for (const pidStr of remainingPids) {
                const pid = parseInt(pidStr)
                if (!isNaN(pid)) {
                  try {
                    process.kill(pid, 'SIGKILL')
                    console.log(`[Manager] Sent SIGKILL to PID ${pid}`)
                  } catch {
                    // Process might not exist
                  }
                }
              }
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
          }
        } catch {
          // lsof might not be available or failed, continue anyway
        }
        
                 // Try to remove socket file
         try {
           await rm(socketPath)
           console.log('[Manager] Removed existing socket file')
           socketCleaned = true
           // Wait for filesystem to update
           await new Promise((resolve) => setTimeout(resolve, 500))
         } catch (rmErr: any) {
           if (rmErr.code === 'ENOENT') {
             // Socket already removed, good
             socketCleaned = true
           } else if (rmErr.code === 'EACCES') {
             // Permission denied - socket might be owned by root
             // If we killed all processes using it, the socket should be released
             // Check if socket is still in use
             try {
               const execPromise = promisify(exec)
               const { stdout } = await execPromise(`lsof -t "${socketPath}" 2>/dev/null || true`)
               const pids = stdout.trim().split('\n').filter(pid => pid && !isNaN(parseInt(pid)))
               if (pids.length === 0) {
                 // No process using it, socket should be released soon
                 console.log('[Manager] Socket file is root-owned but no process using it, will be released')
                 socketCleaned = true
                 // Wait for filesystem to release the socket
                 await new Promise((resolve) => setTimeout(resolve, 2000))
               } else {
                 console.log(`[Manager] Socket still in use by PIDs: ${pids.join(', ')}, permission denied`)
               }
             } catch {
               // lsof failed, assume socket will be released
               socketCleaned = true
               await new Promise((resolve) => setTimeout(resolve, 2000))
             }
           } else {
             console.log(`[Manager] Failed to remove socket (attempt ${retry + 1}/5):`, rmErr.message)
             if (retry < 4) {
               // Wait before retry
               await new Promise((resolve) => setTimeout(resolve, 1000))
             }
           }
         }
      } catch (err) {
        console.log(`[Manager] Socket cleanup error (attempt ${retry + 1}/5):`, err)
        if (retry < 4) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
    }
    
    // Final check: if socket still exists after all retries, log warning
    if (existsSync(socketPath)) {
      console.warn('[Manager] WARNING: Socket file still exists after cleanup attempts, may cause startup issues')
    }
  }
  
  // Check again if core is running (might have been stopped earlier)
  const coreStillRunning = await isCoreRunning()
  if (coreStillRunning) {
    await stopCore()
    // Wait a bit for the socket to be released
    await new Promise((resolve) => setTimeout(resolve, 1000))
    
    // Force remove socket if it still exists after stop
    if (existsSync(socketPath)) {
      console.log('[Manager] Force removing lingering socket file after stopCore')
      try {
        await rm(socketPath)
      } catch (err) {
        console.log('[Manager] Failed to remove socket, may cause startup issue')
      }
      // Wait again for filesystem to update
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  if (tun?.enable && autoSetDNS) {
    try {
      await setPublicDNS()
    } catch (error) {
      await writeFile(logPath(), `[Manager]: set dns failed, ${error}`, {
        flag: 'a'
      })
    }
  }
  const { 'rule-providers': ruleProviders, 'proxy-providers': proxyProviders } =
    await getRuntimeConfig()
  const providerNames = new Set([
    ...Object.keys(ruleProviders || {}),
    ...Object.keys(proxyProviders || {})
  ])
  const matchedProviders = new Set<string>()
  const stdout = createWriteStream(logPath(), { flags: 'a' })
  const stderr = createWriteStream(logPath(), { flags: 'a' })
  const env = {
    DISABLE_LOOPBACK_DETECTOR: String(disableLoopbackDetector),
    DISABLE_EMBED_CA: String(disableEmbedCA),
    DISABLE_SYSTEM_CA: String(disableSystemCA),
    DISABLE_NFTABLES: String(disableNftables),
    SAFE_PATHS: safePaths.join(path.delimiter),
    PATH: process.env.PATH
  }
  let initialized = false
  try {
    child = spawn(
      corePath,
      [
        '-d',
        diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(),
        ctlParam,
        mihomoIpcPath()
      ],
      {
        detached: detached,
        stdio: detached ? 'ignore' : undefined,
        env: env
      }
    )
  } catch (spawnError: any) {
    const errorMsg = spawnError.code === 'UNKNOWN' || spawnError.message?.includes('spawn')
      ? `内核启动失败: ${spawnError.message}\n内核路径: ${corePath}\n请检查内核文件是否存在且可执行。`
      : `内核启动失败: ${spawnError.message || spawnError}`
    console.error('[Manager] Spawn error:', errorMsg)
    await writeFile(logPath(), `[Manager]: ${errorMsg}\n`, { flag: 'a' })
    throw new Error(errorMsg)
  }
  
  // Handle spawn errors immediately after creation
  child.on('error', (spawnError: any) => {
    const errorMsg = spawnError.code === 'UNKNOWN' || spawnError.message?.includes('spawn')
      ? `内核启动失败: ${spawnError.message}\n内核路径: ${corePath}\n请检查内核文件是否存在且可执行。`
      : `内核启动失败: ${spawnError.message || spawnError}`
    console.error('[Manager] Child process error:', errorMsg)
    writeFile(logPath(), `[Manager]: ${errorMsg}\n`, { flag: 'a' }).catch(() => {})
    dialog.showErrorBox('内核启动错误', errorMsg)
  })
  
  if (process.platform === 'win32' && child.pid) {
    os.setPriority(child.pid, os.constants.priority[mihomoCpuPriority])
  }
  if (detached) {
    child.unref()
    return new Promise((resolve) => {
      resolve([new Promise(() => {})])
    })
  }
  child.on('close', async (code, signal) => {
    await writeFile(logPath(), `[Manager]: Core closed, code: ${code}, signal: ${signal}\n`, {
      flag: 'a'
    })
    if (retry) {
      await writeFile(logPath(), `[Manager]: Try Restart Core\n`, { flag: 'a' })
      retry--
      await restartCore()
    } else {
      await stopCore()
    }
  })
  child.stdout?.pipe(stdout)
  child.stderr?.pipe(stderr)
  return new Promise((resolve, reject) => {
    child.stdout?.on('data', async (data) => {
      const str = data.toString()
      if (
        str.includes(
          'Start TUN listening error: configure tun interface: Connect: operation not permitted'
        )
      ) {
        console.log('[Manager] TUN permission denied, attempting to grant permissions')
        
        // Only attempt once per session to avoid repeated password prompts
        if (permissionGrantAttempted) {
          console.log('[Manager] Permission grant already attempted this session, skipping')
          patchControledMihomoConfig({ tun: { enable: false } })
          mainWindow?.webContents.send('controledMihomoConfigUpdated')
          ipcMain.emit('updateTrayMenu')
          
          const corePath = mihomoCorePath(await getAppConfig().then(cfg => cfg.core))
          dialog.showErrorBox(
            '权限授予失败',
            `虚拟网卡需要管理员权限，但多次尝试授权失败。

请手动在终端中运行：

sudo chmod +sx "${corePath}"

如果仍然失败，可能是 macOS 系统安全设置导致的限制。`
          )
          reject('虚拟网卡启动失败，权限授予失败')
          return
        }
        
        // Try to grant SUID permission via osascript password dialog
        permissionGrantAttempted = true
        try {
          await manualGrantCorePermition()
          console.log('[Manager] Permission granted, restarting core')
          
          // Restart core with new permissions
          setTimeout(async () => {
            try {
              await restartCore()
              console.log('[Manager] Core restarted with TUN permissions')
            } catch (restartError) {
              console.error('[Manager] Failed to restart core:', restartError)
              patchControledMihomoConfig({ tun: { enable: false } })
              mainWindow?.webContents.send('controledMihomoConfigUpdated')
              ipcMain.emit('updateTrayMenu')
            }
          }, 500)
          
          // Don't reject, let it restart
          return
        } catch (permError) {
          console.error('[Manager] Failed to grant permission:', permError)
          patchControledMihomoConfig({ tun: { enable: false } })
          mainWindow?.webContents.send('controledMihomoConfigUpdated')
          ipcMain.emit('updateTrayMenu')
          
          // Show helpful error message with instructions
          const corePath = mihomoCorePath(await getAppConfig().then(cfg => cfg.core))
          const errorDetails = permError?.message || String(permError)
          
          // Check if it's a development environment restriction
          const isDevEnvironment = corePath.includes('/Users/') && !corePath.startsWith('/Applications/')
          const isDevRestriction = errorDetails.includes('开发环境限制')
          
          // Check if it's a user cancellation
          const isCancelled = errorDetails.includes('cancel') || 
                            errorDetails.includes('Cancel') || 
                            (permError as any)?.code === -128
          
          if (isCancelled) {
            dialog.showErrorBox(
              '权限授予已取消',
              `虚拟网卡需要管理员权限才能运行。

您取消了权限授予操作。如需使用虚拟网卡功能，请在终端中手动运行：

sudo chmod +sx "${corePath}"

然后重新尝试启用虚拟网卡。`
            )
            reject('用户取消了权限授予操作')
          } else if (isDevRestriction || isDevEnvironment) {
            // Development environment restriction - show friendly message
            dialog.showErrorBox(
              '开发环境限制',
              `虚拟网卡功能在开发环境中无法使用。

这是 macOS 系统完整性保护 (SIP) 的安全限制。在开发环境中（用户目录），即使有管理员权限也无法设置 SUID 位。

✅ 解决方案：
1. 在生产环境中使用（推荐）
   - 打包应用并安装到 /Applications 目录
   - 在生产环境中，虚拟网卡功能可以正常工作

2. 开发测试时使用系统代理模式
   - 关闭虚拟网卡开关
   - 使用"全局"或"规则"模式配合系统代理

3. 临时禁用 SIP（不推荐，仅用于测试）
   - 会降低系统安全性
   - 需要重启进入恢复模式

当前路径: ${corePath}`
            )
            reject('开发环境限制：无法在用户目录中设置 SUID 位')
          } else {
            dialog.showErrorBox(
              '权限授予失败',
              `虚拟网卡需要管理员权限，但自动授权失败。

错误详情: ${errorDetails}

可能的原因：
1. macOS 系统完整性保护 (SIP) 阻止了 SUID 权限设置
2. 文件路径包含特殊字符导致命令执行失败
3. 系统安全设置限制了权限授予

解决方案：
1. 在终端中手动运行：
   sudo chmod +sx "${corePath}"

2. 如果仍然失败，检查 SIP 状态：
   csrutil status
   
   如果 SIP 已启用，可能需要临时禁用 SIP 或使用其他方法。

3. 或者使用系统代理模式代替虚拟网卡模式。`
            )
            reject(`虚拟网卡启动失败，权限授予失败: ${errorDetails}`)
          }
        }
      }

      if (
        (process.platform !== 'win32' && str.includes('External controller unix listen error')) ||
        (process.platform === 'win32' && str.includes('External controller pipe listen error'))
      ) {
        console.error('[Manager] Socket bind error detected, attempting cleanup and retry')
        
        // Clean up socket and retry
        const socketPath = mihomoIpcPath()
        let socketCleaned = false
        
        // Try to clean up socket
        for (let retry = 0; retry < 3 && !socketCleaned; retry++) {
          try {
            // Kill any process using the socket
            try {
              const execPromise = promisify(exec)
              const { stdout } = await execPromise(`lsof -t "${socketPath}" 2>/dev/null || true`)
              const pids = stdout.trim().split('\n').filter(pid => pid && !isNaN(parseInt(pid)))
              if (pids.length > 0) {
                console.log(`[Manager] Found ${pids.length} process(es) using socket: ${pids.join(', ')}`)
                for (const pidStr of pids) {
                  const pid = parseInt(pidStr)
                  if (!isNaN(pid)) {
                    try {
                      process.kill(pid, 'SIGTERM')
                      console.log(`[Manager] Sent SIGTERM to PID ${pid}`)
                    } catch {
                      // Process might not exist
                    }
                  }
                }
                await new Promise((resolve) => setTimeout(resolve, 1000))
                
                // Check again and use SIGKILL if needed
                const { stdout: stdout2 } = await execPromise(`lsof -t "${socketPath}" 2>/dev/null || true`)
                const remainingPids = stdout2.trim().split('\n').filter(pid => pid && !isNaN(parseInt(pid)))
                if (remainingPids.length > 0) {
                  console.log(`[Manager] Processes still using socket, sending SIGKILL: ${remainingPids.join(', ')}`)
                  for (const pidStr of remainingPids) {
                    const pid = parseInt(pidStr)
                    if (!isNaN(pid)) {
                      try {
                        process.kill(pid, 'SIGKILL')
                        console.log(`[Manager] Sent SIGKILL to PID ${pid}`)
                      } catch {
                        // Process might not exist
                      }
                    }
                  }
                  await new Promise((resolve) => setTimeout(resolve, 1000))
                }
              }
            } catch {
              // lsof might not be available
            }
            
            // Try to remove socket file
            try {
              if (existsSync(socketPath)) {
                await rm(socketPath)
                console.log('[Manager] Removed socket file after bind error')
              }
              socketCleaned = true
              await new Promise((resolve) => setTimeout(resolve, 500))
            } catch (rmErr: any) {
              if (rmErr.code === 'ENOENT') {
                socketCleaned = true
              } else {
                console.log(`[Manager] Failed to remove socket (attempt ${retry + 1}/3):`, rmErr.message)
                if (retry < 2) {
                  await new Promise((resolve) => setTimeout(resolve, 1000))
                }
              }
            }
          } catch (err) {
            console.log(`[Manager] Socket cleanup error (attempt ${retry + 1}/3):`, err)
            if (retry < 2) {
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
          }
        }
        
        // Stop current child process
        if (child && !child.killed) {
          try {
            child.kill('SIGTERM')
            await new Promise((resolve) => setTimeout(resolve, 1000))
            if (!child.killed) {
              child.kill('SIGKILL')
            }
          } catch {
            // ignore
          }
        }
        
        // Wait a bit more for everything to settle
        await new Promise((resolve) => setTimeout(resolve, 1000))
        
                 // Retry starting the core
         console.log('[Manager] Retrying core start after socket cleanup')
         try {
           const retryPromises = await startCore(detached)
           // Replace the promise chain
           Promise.all(retryPromises).then(() => {
             resolve(retryPromises)
           }).catch((retryErr) => {
             reject(`控制器监听错误（重试后仍然失败）:\n${str}\n\n重试错误: ${retryErr}`)
           })
           return // Don't call reject, let retry handle it
         } catch (retryErr) {
           reject(`控制器监听错误（清理后重试失败）:\n${str}\n\n重试错误: ${retryErr}`)
           return
         }
      }

      if (process.platform === 'win32' && str.includes('updater: finished')) {
        try {
          await stopCore(true)
          await startCore()
        } catch (e) {
          dialog.showErrorBox('内核启动出错', `${e}`)
        }
      }

      if (
        (process.platform !== 'win32' && str.includes('RESTful API unix listening at')) ||
        (process.platform === 'win32' && str.includes('RESTful API pipe listening at'))
      ) {
        resolve([
          new Promise((resolve) => {
            const handleProviderInitialization = async (logLine: string): Promise<void> => {
              for (const match of logLine.matchAll(
                /Start initial provider ([\w\-!@#$%^&*()\p{Script=Han}]+)/gu
              )) {
                matchedProviders.add(match[1])
              }

              const isDefaultProvider = logLine.includes(
                'Start initial compatible provider default'
              )
              const isAllProvidersMatched =
                providerNames.size > 0 && matchedProviders.size === providerNames.size

              if ((providerNames.size === 0 && isDefaultProvider) || isAllProvidersMatched) {
                matchedProviders.clear()

                const waitForMihomoReady = async (): Promise<void> => {
                  const maxRetries = 30
                  const retryInterval = 100

                  for (let i = 0; i < maxRetries; i++) {
                    try {
                      await mihomoGroups()
                      break
                    } catch (error) {
                      await new Promise((r) => setTimeout(r, retryInterval))
                    }
                  }
                }

                await waitForMihomoReady()
                initialized = true
                Promise.all([
                  new Promise((r) => setTimeout(r, 100)).then(() => {
                    mainWindow?.webContents.send('groupsUpdated')
                    mainWindow?.webContents.send('rulesUpdated')
                  }),
                  uploadRuntimeConfig(),
                  new Promise((r) => setTimeout(r, 100)).then(() =>
                    patchMihomoConfig({ 'log-level': logLevel })
                  )
                ]).then(() => resolve())
              }
            }
            child.stdout?.on('data', (data) => {
              if (!initialized) {
                handleProviderInitialization(data.toString())
              }
            })
          })
        ])
        await startMihomoTraffic()
        await startMihomoConnections()
        await startMihomoLogs()
        await startMihomoMemory()
        retry = 10
      }
    })
  })
}

export async function stopCore(force = false): Promise<void> {
  try {
    if (!force) {
      await recoverDNS()
    }
  } catch (error) {
    await writeFile(logPath(), `[Manager]: recover dns failed, ${error}`, {
      flag: 'a'
    })
  }

  stopMihomoTraffic()
  stopMihomoConnections()
  stopMihomoLogs()
  stopMihomoMemory()

  if (child && !child.killed) {
    await stopChildProcess(child)
    child = undefined as unknown as ChildProcess
  }

  await getAxios(true).catch(() => {})

  // Remove the Unix socket file if it exists (with retry for root-owned sockets)
  const socketPath = mihomoIpcPath()
  if (existsSync(socketPath)) {
    console.log(`[Manager] Removing socket file: ${socketPath}`)
    
    // First, try to kill any process using the socket
    try {
      const execPromise = promisify(exec)
      const { stdout } = await execPromise(`lsof -t "${socketPath}" 2>/dev/null || true`)
      const pids = stdout.trim().split('\n').filter(pid => pid && !isNaN(parseInt(pid)))
      if (pids.length > 0) {
        console.log(`[Manager] Found ${pids.length} process(es) using socket: ${pids.join(', ')}`)
        // Try to kill processes normally first
        for (const pidStr of pids) {
          const pid = parseInt(pidStr)
          if (!isNaN(pid)) {
            try {
              process.kill(pid, 'SIGTERM')
              console.log(`[Manager] Sent SIGTERM to PID ${pid}`)
            } catch {
              // Process might not exist or we don't have permission
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
        
        // If still running, force kill
        let someStillRunning = false
        for (const pidStr of pids) {
          const pid = parseInt(pidStr)
          if (!isNaN(pid)) {
            try {
              process.kill(pid, 0) // Check if still running
              someStillRunning = true
              process.kill(pid, 'SIGKILL')
              console.log(`[Manager] Sent SIGKILL to PID ${pid}`)
            } catch {
              // Process already dead or we don't have permission, ignore
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
        
        // If some processes are still running after SIGKILL, log but don't use sudo
        // Using sudo here would prompt for password too frequently
        if (someStillRunning && process.platform === 'darwin') {
          console.log('[Manager] Some processes still running after SIGKILL, will try to remove socket')
        }
      }
    } catch (lsofError) {
      // lsof might not be available or socket might already be gone
      console.log('[Manager] lsof check failed:', lsofError)
    }
    
    // Now try to remove the socket file
    let removed = false
    for (let i = 0; i < 3; i++) {
      try {
        await rm(socketPath)
        console.log(`[Manager] Socket file removed on attempt ${i + 1}`)
        removed = true
        break
      } catch (err) {
        console.log(`[Manager] Failed to remove socket file on attempt ${i + 1}: ${err}`)
        if (i < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
    }
    // If still failed after retries, just log it
    // Don't try sudo here as it would prompt for password too frequently
    if (!removed) {
      console.log('[Manager] Could not remove socket file, new process may fail to start')
    }
  }

  if (existsSync(path.join(dataDir(), 'core.pid'))) {
    const pidString = await readFile(path.join(dataDir(), 'core.pid'), 'utf-8')
    const pid = parseInt(pidString.trim())
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0)
        process.kill(pid, 'SIGINT')
        await new Promise((resolve) => setTimeout(resolve, 1000))
        try {
          process.kill(pid, 0)
          process.kill(pid, 'SIGKILL')
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }
    await rm(path.join(dataDir(), 'core.pid')).catch(() => {})
  }
}

async function stopChildProcess(process: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!process || process.killed) {
      resolve()
      return
    }

    const pid = process.pid
    if (!pid) {
      resolve()
      return
    }

    process.removeAllListeners()

    let isResolved = false
    const timers: NodeJS.Timeout[] = []

    const resolveOnce = async (): Promise<void> => {
      if (!isResolved) {
        isResolved = true

        timers.forEach((timer) => clearTimeout(timer))
        resolve()
      }
    }

    process.once('close', resolveOnce)
    process.once('exit', resolveOnce)

    try {
      process.kill('SIGINT')

      const timer1 = setTimeout(async () => {
        if (!process.killed && !isResolved) {
          try {
            if (pid) {
              globalThis.process.kill(pid, 0)
              process.kill('SIGTERM')
            }
          } catch {
            await resolveOnce()
          }
        }
      }, 3000)
      timers.push(timer1)

      const timer2 = setTimeout(async () => {
        if (!process.killed && !isResolved) {
          try {
            if (pid) {
              globalThis.process.kill(pid, 0)
              process.kill('SIGKILL')
              await writeFile(logPath(), `[Manager]: Force killed process ${pid} with SIGKILL\n`, {
                flag: 'a'
              })
            }
          } catch {
            // ignore
          }
          await resolveOnce()
        }
      }, 6000)
      timers.push(timer2)
    } catch (error) {
      resolveOnce()
      return
    }
  })
}

/**
 * Check if Mihomo core is currently running
 */
export async function isCoreRunning(): Promise<boolean> {
  try {
    if (child && !child.killed) {
      return true
    }
    // Try to connect to the API socket to verify if core is running
    const axiosIns = await getAxios(true) // Force refresh
    const response = await axiosIns.get('/version') as { version?: string }
    return response?.version !== undefined
  } catch (error) {
    return false
  }
}

/**
 * Smart start or hot reload: check if core is running, if yes hot reload config, otherwise start core
 */
export async function startOrHotReloadCore(): Promise<void> {
  try {
    const isRunning = await isCoreRunning()
    
    if (isRunning) {
      console.log('[Manager] Core is running, attempting hot reload')
      try {
        // Generate new config
        await generateProfile()
        
        // Get the updated runtime config
        const runtimeConfig = await getRuntimeConfig()
        
        // PATCH the config via API for hot reload
        const patchData: Partial<ControllerConfigs> = {
          tun: runtimeConfig.tun as any,
          mode: runtimeConfig.mode,
          'allow-lan': runtimeConfig['allow-lan'],
          'mixed-port': runtimeConfig['mixed-port']
        }
        await patchMihomoConfig(patchData)
        console.log('[Manager] Hot reload completed successfully')
        
        // If TUN is enabled on macOS, set DNS after hot reload
        if (runtimeConfig.tun?.enable && process.platform === 'darwin') {
          try {
            await setPublicDNS()
            console.log('[Manager] DNS set after hot reload')
          } catch (dnsError) {
            console.error('[Manager] Failed to set DNS after hot reload:', dnsError)
          }
        }
      } catch (hotReloadError) {
        console.error('[Manager] Hot reload failed, falling back to restart:', hotReloadError)
        // Fall back to restart if hot reload fails
        await restartCore()
      }
    } else {
      console.log('[Manager] Core is not running, starting fresh')
      await startCore()
    }
  } catch (e) {
    console.error('[Manager] startOrHotReloadCore error:', e)
    throw e
  }
}

export async function restartCore(): Promise<void> {
  try {
    await stopCore()
    await startCore()
  } catch (e) {
    dialog.showErrorBox('内核启动出错', `${e}`)
  }
}

export async function keepCoreAlive(): Promise<void> {
  try {
    await startCore(true)
    if (child && child.pid) {
      await writeFile(path.join(dataDir(), 'core.pid'), child.pid.toString())
    }
  } catch (e) {
    dialog.showErrorBox('内核启动出错', `${e}`)
  }
}

export async function quitWithoutCore(): Promise<void> {
  await keepCoreAlive()
  await startMonitor(true)
  app.exit()
}

async function checkProfile(): Promise<void> {
  const { core = 'mihomo', diffWorkDir = false, safePaths = [] } = await getAppConfig()
  const { current } = await getProfileConfig()
  const corePath = mihomoCorePath(core)
  const configPath = diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work')
  const execFilePromise = promisify(execFile)
  const env = {
    SAFE_PATHS: safePaths.join(path.delimiter)
  }
  
  // 在 macOS 上，先检查内核可执行文件的基本信息
  if (process.platform === 'darwin') {
    // 检查内核可执行文件是否存在
    if (!existsSync(corePath)) {
      const errorMsg = `内核可执行文件不存在: ${corePath}\n请重新安装应用程序或检查内核文件是否完整。`
      console.error('[Manager]', errorMsg)
      await writeFile(logPath(), `[Manager]: ${errorMsg}\n`, { flag: 'a' })
      throw new Error(errorMsg)
    }
    
    // 检查内核可执行文件是否有执行权限
    try {
      accessSync(corePath, constants.F_OK | constants.X_OK)
    } catch (accessError) {
      const errorMsg = `内核可执行文件没有执行权限: ${corePath}\n这可能是 macOS Big Sur 的兼容性问题。\n\n解决方案：\n1. 在终端中运行: chmod +x "${corePath}"\n2. 或者重新安装应用程序`
      console.error('[Manager]', errorMsg)
      await writeFile(logPath(), `[Manager]: ${errorMsg}\n`, { flag: 'a' })
      throw new Error(errorMsg)
    }
    
    // 尝试检查内核可执行文件是否可以运行（通过 --version 或类似命令）
    try {
      await execFilePromise(corePath, ['--version'], { 
        env,
        timeout: 5000,
        maxBuffer: 1024 * 1024
      })
    } catch (versionError: any) {
      // 如果 --version 失败，可能是兼容性问题
      const isBigSur = os.release().startsWith('20.') // Big Sur 版本号以 20. 开头
      if (isBigSur && (versionError.code === 'ENOENT' || versionError.code === 'EACCES' || versionError.signal === 'SIGKILL')) {
        const errorMsg = `内核可执行文件无法在 macOS Big Sur 上运行: ${corePath}\n\n这可能是内核可执行文件与 macOS Big Sur 11.7 不兼容导致的。\n\n可能的解决方案：\n1. 检查内核可执行文件是否为当前架构编译（x64 或 arm64）\n2. 尝试在终端中手动运行: "${corePath}" --version\n3. 如果仍然失败，可能需要使用兼容的内核版本\n4. 检查系统日志: Console.app -> 查看崩溃报告`
        console.error('[Manager]', errorMsg)
        await writeFile(logPath(), `[Manager]: ${errorMsg}\n`, { flag: 'a' })
        throw new Error(errorMsg)
      }
      // 其他错误暂时忽略，继续配置文件检查
    }
  }
  
  try {
    await execFilePromise(
      corePath,
      [
        '-t',
        '-f',
        configPath,
        '-d',
        mihomoTestDir()
      ],
      { env, timeout: 30000, maxBuffer: 1024 * 1024 }
    )
  } catch (error: any) {
    let errorMessage = 'Profile Check Failed'
    const errorDetails: string[] = []
    
    // 检查配置文件是否存在
    if (!existsSync(configPath)) {
      errorDetails.push(`配置文件不存在: ${configPath}`)
    }
    
    // 检查是否是 macOS Big Sur 特定的问题
    if (process.platform === 'darwin') {
      const isBigSur = os.release().startsWith('20.')
      if (isBigSur) {
        errorDetails.push(`\n注意: 检测到 macOS Big Sur 系统，可能存在兼容性问题`)
      }
    }
    
    // 提取错误信息
    if (error && typeof error === 'object') {
      // 检查错误代码
      if (error.code === 'ENOENT') {
        errorDetails.push(`内核可执行文件不存在或无法访问: ${corePath}`)
      } else if (error.code === 'EACCES') {
        errorDetails.push(`内核可执行文件没有执行权限: ${corePath}`)
      } else if (error.code === 'EAGAIN' || error.code === 'EMFILE' || error.code === 'ENFILE') {
        errorDetails.push(`系统资源不足，无法启动内核进程`)
      } else if (error.signal === 'SIGKILL') {
        errorDetails.push(`内核进程被系统强制终止（可能是兼容性问题或系统限制）`)
      } else if (error.code) {
        errorDetails.push(`系统错误代码: ${error.code}`)
      }
      
      // 检查 stdout
      if (error.stdout) {
        const stdoutStr = String(error.stdout)
        const errorLines = stdoutStr
          .split('\n')
          .filter((line) => line.includes('level=error'))
          .map((line) => line.split('level=error')[1]?.trim())
          .filter(Boolean)
        
        if (errorLines.length > 0) {
          errorDetails.push(...errorLines)
        } else if (stdoutStr.trim()) {
          // 如果没有找到 level=error，但 stdout 有内容，显示所有非空行
          const allLines = stdoutStr
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('time='))
          if (allLines.length > 0) {
            errorDetails.push(...allLines)
          }
        }
      }
      
      // 检查 stderr
      if (error.stderr) {
        const stderrStr = String(error.stderr).trim()
        if (stderrStr) {
          const stderrLines = stderrStr
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
          if (stderrLines.length > 0) {
            errorDetails.push(...stderrLines)
          }
        }
      }
      
      // 如果都没有，使用错误消息本身
      if (errorDetails.length === 0 && error.message) {
        errorDetails.push(error.message)
      }
    }
    
    // 添加配置文件路径信息
    if (errorDetails.length > 0) {
      errorMessage = `Profile Check Failed:\n内核路径: ${corePath}\n配置文件: ${configPath}\n\n${errorDetails.join('\n')}`
    } else {
      errorMessage = `Profile Check Failed:\n内核路径: ${corePath}\n配置文件: ${configPath}\n\n未知错误，请检查配置文件格式是否正确。`
    }
    
    console.error('[Manager] Profile check failed:', errorMessage)
    await writeFile(logPath(), `[Manager]: ${errorMessage}\n`, { flag: 'a' })
    throw new Error(errorMessage)
  }
}

let manualGrantInProgress = false

export async function manualGrantCorePermition(): Promise<void> {
  const { core = 'mihomo' } = await getAppConfig()
  const corePath = mihomoCorePath(core)

  if (manualGrantInProgress) {
    console.log('[Manager] Permission grant already in progress, skip duplicate request')
    return
  }

  manualGrantInProgress = true

  try {
    // Skip expensive flow when permission already granted
    if (await checkCorePermission()) {
      permissionGrantAttempted = true
      return
    }

    if (process.platform === 'darwin') {
      const isDevEnvironment =
        corePath.includes('/Users/') && !corePath.startsWith('/Applications/')

      if (isDevEnvironment) {
        throw new Error(
          `开发环境限制：无法在用户目录中设置 SUID 位。\n\n` +
            `这是 macOS 系统完整性保护 (SIP) 的安全限制。即使有管理员权限也会失败。\n\n` +
            `解决方案：\n` +
            `1. 打包应用并安装到 /Applications 目录（推荐）；\n` +
            `2. 或禁用 TUN，改用系统代理模式；\n` +
            `3. 如需测试，可临时禁用 SIP（不推荐）。`
        )
      }

      console.log('[Manager] Attempting to grant permission via osascript for:', corePath)

      const shellEscapedPath = corePath.replace(/'/g, `'\\''`)
      const shellCommand = `/usr/sbin/chown root:admin '${shellEscapedPath}' && /bin/chmod +sx '${shellEscapedPath}'`
      const applescriptCommand = `do shell script "${shellCommand
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')}" with administrator privileges`

      try {
        const execFilePromise = promisify(execFile)
        const { stdout, stderr } = await execFilePromise(
          'osascript',
          ['-e', applescriptCommand],
          {
            timeout: 30000,
            maxBuffer: 1024 * 1024
          }
        )

        if (stdout) {
          console.log('[Manager] osascript stdout:', stdout.trim())
        }
        if (stderr && stderr.trim()) {
          console.warn('[Manager] osascript stderr:', stderr.trim())
        }
      } catch (error: any) {
        const message = error?.message || String(error)
        console.error('[Manager] Failed to grant permission via osascript:', message)

        if (message.includes('User canceled') || message.includes('(-128)')) {
          throw new Error('用户取消了权限授予操作')
        }

        throw new Error(
          `自动权限授予失败：${message}\n\n` +
            `请在终端手动执行以下命令后重试：\n` +
            `sudo chmod +sx "${corePath}"`
        )
      }

      // Give the system a brief moment to update file metadata
      await new Promise((resolve) => setTimeout(resolve, 200))

      if (!(await checkCorePermission())) {
        throw new Error(
          `无法设置 SUID 位，可能是 macOS 系统完整性保护 (SIP) 阻止了权限修改。\n\n` +
            `请手动运行：\n` +
            `sudo chown root:admin "${corePath}" && sudo chmod +sx "${corePath}"\n\n` +
            `若仍然失败，请检查 SIP 状态 (csrutil status)，或使用系统代理模式。`
        )
      }

      console.log('[Manager] Permission granted successfully')
    } else if (process.platform === 'linux') {
      const execFilePromise = promisify(execFile)
      await execFilePromise('pkexec', [
        'bash',
        '-c',
        `chown root:root "${corePath}" && chmod +sx "${corePath}"`
      ])
    }
  } finally {
    manualGrantInProgress = false
    permissionGrantAttempted = true
  }
}

export async function checkCorePermission(): Promise<boolean> {
  const { core = 'mihomo' } = await getAppConfig()
  const corePath = mihomoCorePath(core)
  const execPromise = promisify(exec)

  try {
    console.log('[Manager] Checking permission for:', corePath)
    const { stdout } = await execPromise(`ls -l "${corePath}"`)
    const permissions = stdout.trim().split(/\s+/)[0]
    console.log('[Manager] Current permissions:', permissions)
    const hasSUID = permissions.includes('s') || permissions.includes('S')
    console.log('[Manager] Has SUID:', hasSUID)
    return hasSUID
  } catch (error) {
    console.error('[Manager] Failed to check permission:', error)
    return false
  }
}

export async function revokeCorePermission(): Promise<void> {
  const { core = 'mihomo' } = await getAppConfig()
  const corePath = mihomoCorePath(core)
  const execPromise = promisify(exec)
  const execFilePromise = promisify(execFile)

  if (process.platform === 'darwin') {
    const shell = `chmod a-s ${corePath.replace(' ', '\\\\ ')} && rm -f ${mihomoIpcPath()}`
    const command = `do shell script "${shell}" with administrator privileges`
    await execPromise(`osascript -e '${command}'`)
  }
  if (process.platform === 'linux') {
    await execFilePromise('pkexec', [
      'bash',
      '-c',
      `chmod a-s "${corePath}" && rm -f "${mihomoIpcPath()}"`
    ])
  }
}

export async function getDefaultDevice(): Promise<string> {
  const execPromise = promisify(exec)
  const { stdout: deviceOut } = await execPromise(`route -n get default`)
  let device = deviceOut.split('\n').find((s) => s.includes('interface:'))
  device = device?.trim().split(' ').slice(1).join(' ')
  if (!device) throw new Error('Get device failed')
  return device
}

async function getDefaultService(): Promise<string> {
  const execPromise = promisify(exec)
  const device = await getDefaultDevice()
  const { stdout: order } = await execPromise(`networksetup -listnetworkserviceorder`)
  const block = order.split('\n\n').find((s) => s.includes(`Device: ${device}`))
  if (!block) throw new Error('Get networkservice failed')
  for (const line of block.split('\n')) {
    if (line.match(/^\(\d+\).*/)) {
      return line.trim().split(' ').slice(1).join(' ')
    }
  }
  throw new Error('Get service failed')
}

async function getOriginDNS(): Promise<void> {
  const execPromise = promisify(exec)
  const service = await getDefaultService()
  const { stdout: dns } = await execPromise(`networksetup -getdnsservers "${service}"`)
  if (dns.startsWith("There aren't any DNS Servers set on")) {
    await patchAppConfig({ originDNS: 'Empty' })
  } else {
    await patchAppConfig({ originDNS: dns.trim().replace(/\n/g, ' ') })
  }
}

async function setDNS(dns: string): Promise<void> {
  const service = await getDefaultService()
  const execPromise = promisify(exec)
  await execPromise(`networksetup -setdnsservers "${service}" ${dns}`)
}

export async function setPublicDNS(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (electronNet.isOnline()) {
    const { originDNS } = await getAppConfig()
    if (!originDNS) {
      await getOriginDNS()
      await setDNS('223.5.5.5')
    }
  } else {
    if (setPublicDNSTimer) clearTimeout(setPublicDNSTimer)
    setPublicDNSTimer = setTimeout(() => setPublicDNS(), 5000)
  }
}

async function recoverDNS(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (electronNet.isOnline()) {
    const { originDNS } = await getAppConfig()
    if (originDNS) {
      await setDNS(originDNS)
      await patchAppConfig({ originDNS: undefined })
    }
  } else {
    if (recoverDNSTimer) clearTimeout(recoverDNSTimer)
    recoverDNSTimer = setTimeout(() => recoverDNS(), 5000)
  }
}

export async function startNetworkDetection(): Promise<void> {
  const {
    onlyActiveDevice = false,
    networkDetectionBypass = [],
    networkDetectionInterval = 10,
    sysProxy = { enable: false }
  } = await getAppConfig()
  const { tun: { device = process.platform === 'darwin' ? undefined : 'mihomo' } = {} } =
    await getControledMihomoConfig()
  if (networkDetectionTimer) {
    clearInterval(networkDetectionTimer)
  }
  const extendedBypass = networkDetectionBypass.concat(
    [device, 'lo', 'docker0', 'utun'].filter((item): item is string => item !== undefined)
  )

  networkDetectionTimer = setInterval(async () => {
    if (isAnyNetworkInterfaceUp(extendedBypass) && electronNet.isOnline()) {
      if ((networkDownHandled && !child) || (child && child.killed)) {
        startCore()
        if (sysProxy.enable) triggerSysProxy(true, onlyActiveDevice)
        networkDownHandled = false
      }
    } else {
      if (!networkDownHandled) {
        if (sysProxy.enable) disableSysProxy(onlyActiveDevice)
        await stopCore()
        networkDownHandled = true
      }
    }
  }, networkDetectionInterval * 1000)
}

export async function stopNetworkDetection(): Promise<void> {
  if (networkDetectionTimer) {
    clearInterval(networkDetectionTimer)
    networkDetectionTimer = null
  }
}

function isAnyNetworkInterfaceUp(excludedKeywords: string[] = []): boolean {
  const interfaces = os.networkInterfaces()
  return Object.entries(interfaces).some(([name, ifaces]) => {
    if (excludedKeywords.some((keyword) => name.includes(keyword))) return false

    return ifaces?.some((iface) => {
      return !iface.internal && (iface.family === 'IPv4' || iface.family === 'IPv6')
    })
  })
}
