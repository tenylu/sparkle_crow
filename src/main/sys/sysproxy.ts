/**
 * 系统代理设置模块
 * 
 * 权限判断逻辑：
 * 
 * 1. 代理开关触发流程：
 *    - 用户切换代理开关 -> triggerSysProxy() -> setSysProxy() / disableSysProxy()
 * 
 * 2. 权限判断机制（按平台）：
 * 
 *    Windows 平台：
 *    - 首次启动：尝试创建任务计划（需要管理员权限，在 src/main/index.ts 中处理）
 *    - 创建失败：尝试通过任务计划启动（如果任务已存在）
 *    - 都失败：提示"首次启动请以管理员权限运行"
 *    - 代理开关开启时：直接执行 sysproxy.exe（通过任务计划启动的应用已有管理员权限）
 *    - 若失败，会抛出错误并被捕获
 * 
 *    macOS 平台：
 *    - 检查 Helper socket 是否存在（/tmp/sparkle-helper.sock）
 *    - 如果不存在，检查 Helper 是否已安装（isHelperInstalled）
 *    - 如果未安装，抛出"系统代理 Helper 未安装"错误，提示用户安装
 *    - 如果已安装但未运行，尝试启动 Helper（restartHelper）
 *    - 如果启动失败，抛出错误提示用户检查权限
 * 
 *    Linux 平台：
 *    - 直接执行 sysproxy 命令，没有特殊权限检查
 *    - 如果失败，会抛出错误
 * 
 * 3. 首次使用判断方式：
 *    - Windows: 通过任务计划检查（checkElevateTask）
 *    - macOS: 通过 Helper 文件和服务状态检查（isHelperInstalled）
 *    - Linux: 直接尝试执行命令，根据错误判断
 */

import { getAppConfig, getControledMihomoConfig } from '../config'
import { pacPort, startPacServer, stopPacServer } from '../resolve/server'
import { promisify } from 'util'
import { exec, execFile } from 'child_process'
import { sysproxyPath, exePath } from '../utils/dirs'
import { net } from 'electron'
import axios from 'axios'
import { existsSync } from 'fs'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

let defaultBypass: string[]
let triggerSysProxyTimer: NodeJS.Timeout | null = null
const helperSocketPath = '/tmp/sparkle-helper.sock'

export async function triggerSysProxy(enable: boolean, onlyActiveDevice: boolean): Promise<void> {
  if (net.isOnline()) {
    if (enable) {
      await setSysProxy(onlyActiveDevice)
    } else {
      await disableSysProxy(onlyActiveDevice)
    }
  } else {
    if (triggerSysProxyTimer) clearTimeout(triggerSysProxyTimer)
    triggerSysProxyTimer = setTimeout(() => triggerSysProxy(enable, onlyActiveDevice), 5000)
  }
}

async function setSysProxy(onlyActiveDevice: boolean): Promise<void> {
  if (process.platform === 'linux')
    defaultBypass = [
      'localhost',
      '.local',
      '127.0.0.1/8',
      '192.168.0.0/16',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '::1'
    ]
  if (process.platform === 'darwin')
    defaultBypass = [
      '127.0.0.1/8',
      '192.168.0.0/16',
      '10.0.0.0/8',
      '172.16.0.0/12',
      'localhost',
      '*.local',
      '*.crashlytics.com',
      '<local>'
    ]
  if (process.platform === 'win32')
    defaultBypass = [
      'localhost',
      '127.*',
      '192.168.*',
      '10.*',
      '172.16.*',
      '172.17.*',
      '172.18.*',
      '172.19.*',
      '172.20.*',
      '172.21.*',
      '172.22.*',
      '172.23.*',
      '172.24.*',
      '172.25.*',
      '172.26.*',
      '172.27.*',
      '172.28.*',
      '172.29.*',
      '172.30.*',
      '172.31.*',
      '<local>'
    ]
  await startPacServer()
  const { sysProxy } = await getAppConfig()
  const { mode, host, bypass = defaultBypass } = sysProxy
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  const execFilePromise = promisify(execFile)
  switch (mode || 'manual') {
    case 'auto': {
      if (process.platform === 'darwin') {
        // Check if helper socket exists before attempting connection
        if (!existsSync(helperSocketPath)) {
          console.warn('[SysProxy] Helper socket not found, checking if Helper is installed')
          // Check if Helper is installed
          const helperInstalled = await isHelperInstalled().catch(() => false)
          if (!helperInstalled) {
            throw new Error('系统代理 Helper 未安装。请重新安装应用程序以安装 Helper，或手动安装 Helper。')
          }
          // Helper is installed but socket doesn't exist, try to restart it
          try {
            await restartHelper()
            // Wait a bit for helper to start
            await new Promise(resolve => setTimeout(resolve, 2000))
            // Check if socket exists now
            if (!existsSync(helperSocketPath)) {
              throw new Error('无法启动系统代理 Helper，请检查系统权限设置。')
            }
          } catch (error: any) {
            if (error.message && error.message.includes('Helper')) {
              throw error
            }
            throw new Error(`无法启动系统代理 Helper：${error.message}。请检查系统权限设置。`)
          }
        }
        
        try {
          const response = await axios.post(
            'http://localhost/pac',
            {
              url: `http://${host || '127.0.0.1'}:${pacPort}/pac`,
              only_active_device: onlyActiveDevice
            },
            {
              socketPath: helperSocketPath,
              validateStatus: () => true,
              timeout: 5000
            }
          )
          
          // Check response status (200 OK or 204 No Content are both success)
          if (response.status !== 200 && response.status !== 204) {
            throw new Error(`系统代理设置失败，Helper 返回状态码：${response.status}`)
          }
        } catch (error: any) {
          if (error.message && error.message.includes('Helper')) {
            throw error
          }
          console.error('[SysProxy] Failed to set PAC proxy via helper:', error.message)
          throw new Error(`设置系统代理失败：${error.message}。请检查 Helper 是否正常运行。`)
        }
      } else if (process.platform === 'win32') {
        // Windows 平台：直接执行 sysproxy
        // 权限检查在应用启动时通过任务计划完成（createElevateTaskSync）
        // 如果任务计划不存在，首次启动会提示用户以管理员权限运行
        // 这里直接执行 sysproxy，若失败会抛出错误
        try {
          await execFilePromise(sysproxyPath(), [
            'pac',
            '--url',
            `http://${host || '127.0.0.1'}:${pacPort}/pac`
          ])
        } catch (error: any) {
          // Windows 权限不足时，通常会抛出错误
          console.error('[SysProxy] Failed to set PAC proxy on Windows:', error.message)
          throw new Error(`设置系统代理失败：${error.message}。可能需要管理员权限。`)
        }
      } else {
        // Linux 平台：直接执行命令
        await execFilePromise(sysproxyPath(), [
          'pac',
          '--url',
          `http://${host || '127.0.0.1'}:${pacPort}/pac`
        ])
      }
      break
    }

    case 'manual': {
      if (port != 0) {
        if (process.platform === 'darwin') {
          // Check if helper socket exists before attempting connection
          if (!existsSync(helperSocketPath)) {
            console.warn('[SysProxy] Helper socket not found, checking if Helper is installed')
            // Check if Helper is installed
            const helperInstalled = await isHelperInstalled().catch(() => false)
            if (!helperInstalled) {
              throw new Error('系统代理 Helper 未安装。请重新安装应用程序以安装 Helper，或手动安装 Helper。')
            }
            // Helper is installed but socket doesn't exist, try to restart it
            try {
              await restartHelper()
              // Wait a bit for helper to start
              await new Promise(resolve => setTimeout(resolve, 2000))
              // Check if socket exists now
              if (!existsSync(helperSocketPath)) {
                throw new Error('无法启动系统代理 Helper，请检查系统权限设置。')
              }
            } catch (error: any) {
              if (error.message && error.message.includes('Helper')) {
                throw error
              }
              throw new Error(`无法启动系统代理 Helper：${error.message}。请检查系统权限设置。`)
            }
          }
          
          try {
            const response = await axios.post(
              'http://localhost/proxy',
              {
                server: `${host || '127.0.0.1'}:${port}`,
                bypass: bypass.join(','),
                only_active_device: onlyActiveDevice
              },
              {
                socketPath: helperSocketPath,
                validateStatus: () => true,
                timeout: 5000
              }
            )
            
            // Check response status (200 OK or 204 No Content are both success)
            if (response.status !== 200 && response.status !== 204) {
              throw new Error(`系统代理设置失败，Helper 返回状态码：${response.status}`)
            }
          } catch (error: any) {
            if (error.message && error.message.includes('Helper')) {
              throw error
            }
            console.error('[SysProxy] Failed to set manual proxy via helper:', error.message)
            throw new Error(`设置系统代理失败：${error.message}。请检查 Helper 是否正常运行。`)
          }
        } else if (process.platform === 'win32') {
          // Windows 平台：直接执行 sysproxy
          // 权限检查在应用启动时通过任务计划完成（createElevateTaskSync）
          // 如果任务计划不存在，首次启动会提示用户以管理员权限运行
          // 这里直接执行 sysproxy，若失败会抛出错误
          try {
            await execFilePromise(sysproxyPath(), [
              'proxy',
              '--server',
              `${host || '127.0.0.1'}:${port}`,
              '--bypass',
              bypass.join(';')
            ])
          } catch (error: any) {
            // Windows 权限不足时，通常会抛出错误
            console.error('[SysProxy] Failed to set manual proxy on Windows:', error.message)
            throw new Error(`设置系统代理失败：${error.message}。可能需要管理员权限。`)
          }
        } else {
          // Linux 平台：直接执行命令
          await execFilePromise(sysproxyPath(), [
            'proxy',
            '--server',
            `${host || '127.0.0.1'}:${port}`,
            '--bypass',
            bypass.join(',')
          ])
        }
      }
      break
    }
  }
}

export async function disableSysProxy(onlyActiveDevice: boolean): Promise<void> {
  await stopPacServer()
  const execFilePromise = promisify(execFile)
  if (process.platform === 'darwin') {
    // Check if helper socket exists before attempting connection
    if (!existsSync(helperSocketPath)) {
      // If socket doesn't exist, proxy is probably not enabled, just return
      console.warn('[SysProxy] Helper socket not found, proxy may not be enabled')
      return
    }
    
    try {
      await axios.post(
        'http://localhost/disable',
        { only_active_device: onlyActiveDevice },
        {
          socketPath: helperSocketPath,
          validateStatus: () => true,
          timeout: 5000
        }
      )
    } catch (error: any) {
      // Don't throw error when disabling, just log it
      console.warn('[SysProxy] Failed to disable proxy via helper:', error.message)
    }
  } else {
    // Windows/Linux 平台：直接执行 disable 命令
    // 关闭代理时不需要特殊权限检查，如果失败只记录日志
    try {
      await execFilePromise(sysproxyPath(), ['disable'])
    } catch (error: any) {
      // Don't throw error when disabling, just log it
      console.warn('[SysProxy] Failed to disable proxy:', error.message)
    }
  }
}

export async function isHelperInstalled(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true
  }
  
  // First check if the helper file exists
  const helperPath = '/Library/PrivilegedHelperTools/sparkle.helper'
  const plistPath = '/Library/LaunchDaemons/sparkle.helper.plist'
  
  if (!existsSync(helperPath) || !existsSync(plistPath)) {
    console.log('[SysProxy] Helper not installed: missing files')
    return false
  }
  
  // Then check if the helper is running by trying to ping it
  try {
    await axios.get('http://localhost/ping', {
      socketPath: helperSocketPath,
      validateStatus: () => true,
      timeout: 1000
    })
    return true
  } catch (error) {
    // Helper file exists but not running, try to start it
    console.log('[SysProxy] Helper installed but not running, attempting to start')
    try {
      await restartHelper()
      // Wait a bit for helper to start
      await new Promise(resolve => setTimeout(resolve, 1000))
      // Try ping again
      await axios.get('http://localhost/ping', {
        socketPath: helperSocketPath,
        validateStatus: () => true,
        timeout: 1000
      })
      return true
    } catch {
      // Helper exists but cannot be started
      console.log('[SysProxy] Helper installed but cannot be started')
      return false
    }
  }
}

export async function installHelper(): Promise<void> {
  if (process.platform !== 'darwin') {
    return
  }
  
  const helperPath = sysproxyPath()
  const appPath = exePath()
  
  if (!existsSync(helperPath)) {
    throw new Error('Helper 文件不存在')
  }
  
  // Find the .app bundle
  // exePath() returns something like /Applications/CrowVPN.app/Contents/MacOS/CrowVPN
  // We need to find the .app bundle
  let appBundle = ''
  if (appPath.includes('.app/')) {
    const appIndex = appPath.indexOf('.app/')
    appBundle = appPath.substring(0, appIndex + 4)
  } else if (appPath.endsWith('.app')) {
    appBundle = appPath
  }
  
  if (!appBundle || !existsSync(appBundle)) {
    throw new Error(`无法找到应用 bundle: ${appPath}`)
  }
  
  const NEW_SYSPROXY = `${appBundle}/Contents/Resources/files/sysproxy`
  const OLD_SYSPROXY = '/Library/PrivilegedHelperTools/sparkle.helper'
  
  if (!existsSync(NEW_SYSPROXY)) {
    throw new Error('Helper 文件在应用 bundle 中不存在')
  }
  
  const execPromise = promisify(exec)
  
  // Create a temporary script file
  const scriptPath = join(tmpdir(), `install-helper-${Date.now()}.sh`)
  const installScript = `#!/bin/sh
set -e
mkdir -p /Library/PrivilegedHelperTools
cp "${NEW_SYSPROXY}" "${OLD_SYSPROXY}"
chown root:wheel "${OLD_SYSPROXY}"
chmod 544 "${OLD_SYSPROXY}"

cat > /Library/LaunchDaemons/sparkle.helper.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
        <key>Label</key>
        <string>sparkle.helper</string>
        <key>MachServices</key>
        <dict>
                <key>sparkle.helper</key>
                <true/>
        </dict>
        <key>KeepAlive</key>
        <true/>
        <key>Program</key>
        <string>/Library/PrivilegedHelperTools/sparkle.helper</string>
        <key>ProgramArguments</key>
        <array>
                <string>/Library/PrivilegedHelperTools/sparkle.helper</string>
                <string>server</string>
        </array>
        <key>StandardErrorPath</key>
        <string>/tmp/sparkle.helper.log</string>
        <key>StandardOutPath</key>
        <string>/tmp/sparkle.helper.log</string>
    </dict>
</plist>
EOF

chown root:wheel /Library/LaunchDaemons/sparkle.helper.plist
chmod 644 /Library/LaunchDaemons/sparkle.helper.plist
launchctl unload /Library/LaunchDaemons/sparkle.helper.plist 2>/dev/null || true
launchctl load /Library/LaunchDaemons/sparkle.helper.plist
launchctl start sparkle.helper
`
  
  try {
    // Write script to temporary file
    await writeFile(scriptPath, installScript, { mode: 0o755 })
    
    // Execute script with administrator privileges
    const escapedPath = scriptPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    await execPromise(
      `osascript -e 'do shell script "bash \\"${escapedPath}\\" && rm -f \\"${escapedPath}\\"" with administrator privileges'`
    )
  } catch (error: any) {
    // Try to clean up script file
    try {
      await unlink(scriptPath).catch(() => {})
    } catch {
      // ignore
    }
    throw new Error(`安装 Helper 失败：${error.message || error}`)
  }
}

export async function restartHelper(): Promise<void> {
  if (process.platform === 'darwin') {
    try {
      const execPromise = promisify(exec)
      await execPromise(
        `osascript -e 'do shell script "launchctl unload /Library/LaunchDaemons/sparkle.helper.plist 2>/dev/null; launchctl load /Library/LaunchDaemons/sparkle.helper.plist 2>/dev/null; launchctl start sparkle.helper 2>/dev/null" with administrator privileges'`
      )
    } catch {
      // ignore
    }
  }
}
