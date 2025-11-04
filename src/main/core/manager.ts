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
import { createWriteStream, existsSync } from 'fs'
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
  } catch (error) {
    if (core === 'system') {
      await patchAppConfig({ core: 'mihomo' })
      return startCore(detached)
    }
    throw error
  }

  // Check if the configured port is available, if not, find an available port
  const actualPort = configuredPort || 7890
  const isPortAvailable = await new Promise<boolean>((resolve) => {
    const testServer = net.createServer()
    testServer.once('error', () => resolve(false))
    testServer.once('listening', () => {
      testServer.close(() => resolve(true))
    })
    testServer.listen(actualPort, '127.0.0.1')
  })

  if (!isPortAvailable) {
    // Port is in use, find an available port
    try {
      const availablePort = await findAvailablePort(actualPort)
      console.log(`[Manager] Port ${actualPort} is in use, switching to port ${availablePort}`)
      await patchControledMihomoConfig({ 'mixed-port': availablePort })
      await writeFile(logPath(), `[Manager]: Port ${actualPort} is in use, switched to port ${availablePort}\n`, {
        flag: 'a'
      })
    } catch (error) {
      console.error('[Manager] Failed to find available port:', error)
      await writeFile(logPath(), `[Manager]: Failed to find available port: ${error}\n`, {
        flag: 'a'
      })
    }
  }

  await generateProfile()
  await checkProfile()
  
  // Always clean up socket file before starting (even if not running)
  // This handles cases where previous instance crashed and left socket file
  const socketPath = mihomoIpcPath()
  if (existsSync(socketPath)) {
    console.log('[Manager] Found existing socket file, attempting cleanup')
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
                process.kill(pid, 'SIGTERM')
                console.log(`[Manager] Sent SIGTERM to PID ${pid}`)
              } catch {
                // Process might not exist
              }
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      } catch {
        // lsof might not be available or failed, continue anyway
      }
      
      // Remove socket file
      await rm(socketPath)
      console.log('[Manager] Removed existing socket file')
      // Wait for filesystem to update
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch (err) {
      console.log('[Manager] Failed to remove socket, may cause startup issue:', err)
    }
  }
  
  // Only stop core if it's already running
  const running = await isCoreRunning()
  if (running) {
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
          dialog.showErrorBox(
            '权限授予失败',
            `虚拟网卡需要管理员权限，但自动授权失败。

macOS 可能阻止了 SUID 权限设置。请尝试在终端中手动运行：

sudo chmod +sx "${corePath}"

如果仍然失败，可能是 macOS 系统安全设置导致的限制。`
          )
          reject('虚拟网卡启动失败，权限授予失败')
        }
      }

      if (
        (process.platform !== 'win32' && str.includes('External controller unix listen error')) ||
        (process.platform === 'win32' && str.includes('External controller pipe listen error'))
      ) {
        reject(`控制器监听错误:\n${str}`)
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
  const execFilePromise = promisify(execFile)
  const env = {
    SAFE_PATHS: safePaths.join(path.delimiter)
  }
  try {
    await execFilePromise(
      corePath,
      [
        '-t',
        '-f',
        diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work'),
        '-d',
        mihomoTestDir()
      ],
      { env }
    )
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      const { stdout } = error as { stdout: string }
      const errorLines = stdout
        .split('\n')
        .filter((line) => line.includes('level=error'))
        .map((line) => line.split('level=error')[1])
      throw new Error(`Profile Check Failed:\n${errorLines.join('\n')}`)
    } else {
      throw error
    }
  }
}

export async function manualGrantCorePermition(): Promise<void> {
  const { core = 'mihomo' } = await getAppConfig()
  const corePath = mihomoCorePath(core)
  const execPromise = promisify(exec)
  const execFilePromise = promisify(execFile)
  
  if (process.platform === 'darwin') {
    // Escape path for shell and then for AppleScript
    // First escape for shell: handle quotes and spaces
    const shellEscaped = corePath.replace(/"/g, '\\"').replace(/\$/g, '\\$')
    // Construct shell command
    const shellCmd = `chown root:admin "${shellEscaped}" && chmod +sx "${shellEscaped}"`
    // Then escape for AppleScript string
    const applescriptEscaped = shellCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    // Build final osascript command
    const osascriptCmd = `osascript -e 'do shell script "${applescriptEscaped}" with administrator privileges'`
    
    console.log('[Manager] Granting permission via osascript:', osascriptCmd.substring(0, 200))
    await execPromise(osascriptCmd)
  }
  if (process.platform === 'linux') {
    await execFilePromise('pkexec', [
      'bash',
      '-c',
      `chown root:root "${corePath}" && chmod +sx "${corePath}"`
    ])
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
