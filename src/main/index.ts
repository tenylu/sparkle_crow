import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcMainHandlers } from './utils/ipc'
import windowStateKeeper from 'electron-window-state'
import {
  app,
  shell,
  BrowserWindow,
  Menu,
  dialog,
  Notification,
  powerMonitor,
  ipcMain
} from 'electron'
import os from 'os'
import { addOverrideItem, addProfileItem, getAppConfig } from './config'
import { quitWithoutCore, startCore, stopCore } from './core/manager'
import { triggerSysProxy, disableSysProxy } from './sys/sysproxy'
import icon from '../../resources/icon.png?asset'
import { createTray, updateTrayIconBrightness } from './resolve/tray'
import { createApplicationMenu } from './resolve/menu'
import { init } from './utils/init'
import { join } from 'path'
import { initShortcut } from './resolve/shortcut'
import { execSync, spawn } from 'child_process'
import { createElevateTaskSync } from './sys/misc'
import { initProfileUpdater } from './core/profileUpdater'
import { existsSync, writeFileSync } from 'fs'
import { exePath, taskDir } from './utils/dirs'
import path from 'path'
import { startMonitor } from './resolve/trafficMonitor'
import { showFloatingWindow } from './resolve/floatingWindow'
import iconv from 'iconv-lite'
import { getAppConfigSync } from './config/app'
import { getUserAgent } from './utils/userAgent'
import { XboardClient } from './api/xboard-client'
import { getXboardConfig, setXboardConfig, isLoggedIn, clearXboardConfig, setXboardProxyState, buildXboardConfig } from './config/xboard'
import { fetchSubscribe, parseClashYAML, type ParsedNode } from './api/subscribe-parser'
import { stringifyYaml } from './utils/yaml'
import YAML from 'yaml'

let quitTimeout: NodeJS.Timeout | null = null
export let mainWindow: BrowserWindow | null = null

const syncConfig = getAppConfigSync()

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

if (
  process.platform === 'win32' &&
  !is.dev &&
  !process.argv.includes('noadmin') &&
  syncConfig.corePermissionMode === 'elevated'
) {
  try {
    createElevateTaskSync()
  } catch (createError) {
    try {
      if (process.argv.slice(1).length > 0) {
        writeFileSync(path.join(taskDir(), 'param.txt'), process.argv.slice(1).join(' '))
      } else {
        writeFileSync(path.join(taskDir(), 'param.txt'), 'empty')
      }
      if (!existsSync(path.join(taskDir(), 'sparkle-run.exe'))) {
        throw new Error('sparkle-run.exe not found')
      } else {
        execSync('%SystemRoot%\\System32\\schtasks.exe /run /tn sparkle-run')
      }
    } catch (e) {
      let createErrorStr = `${createError}`
      let eStr = `${e}`
      try {
        createErrorStr = iconv.decode((createError as { stderr: Buffer }).stderr, 'gbk')
        eStr = iconv.decode((e as { stderr: Buffer }).stderr, 'gbk')
      } catch {
        // ignore
      }
      dialog.showErrorBox(
        '首次启动请以管理员权限运行',
        `首次启动请以管理员权限运行\n${createErrorStr}\n${eStr}`
      )
    } finally {
      app.exit()
    }
  }
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
}

export function customRelaunch(): void {
  const script = `while kill -0 ${process.pid} 2>/dev/null; do
  sleep 0.1
done
${process.argv.join(' ')} & disown
exit
`
  spawn('sh', ['-c', `"${script}"`], {
    shell: true,
    detached: true,
    stdio: 'ignore'
  })
}

if (process.platform === 'linux') {
  app.relaunch = customRelaunch
}

if (process.platform === 'win32' && !exePath().startsWith('C')) {
  // https://github.com/electron/electron/issues/43278
  // https://github.com/electron/electron/issues/36698
  app.commandLine.appendSwitch('in-process-gpu')
}

const initPromise = init()

if (syncConfig.disableGPU) {
  app.disableHardwareAcceleration()
}

app.on('second-instance', async (_event, commandline) => {
  showMainWindow()
  const url = commandline.pop()
  if (url) {
    await handleDeepLink(url)
  }
})

app.on('open-url', async (_event, url) => {
  showMainWindow()
  await handleDeepLink(url)
})

let isQuitting = false,
  notQuitDialog = false

export function setNotQuitDialog(): void {
  notQuitDialog = true
}

function showWindow(): number {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    } else if (!mainWindow.isVisible()) {
      mainWindow.show()
    }
    mainWindow.focusOnWebView()
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu')
    mainWindow.focus()
    mainWindow.setAlwaysOnTop(false)

    if (!mainWindow.isMinimized()) {
      return 100
    }
  }
  return 500
}

function showQuitConfirmDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve(true)
      return
    }

    const delay = showWindow()
    setTimeout(() => {
      mainWindow?.webContents.send('show-quit-confirm')
      const handleQuitConfirm = (_event: Electron.IpcMainEvent, confirmed: boolean): void => {
        ipcMain.off('quit-confirm-result', handleQuitConfirm)
        resolve(confirmed)
      }
      ipcMain.once('quit-confirm-result', handleQuitConfirm)
    }, delay)
  })
}

app.on('before-quit', async (e) => {
  if (!isQuitting && !notQuitDialog) {
    e.preventDefault()

    const confirmed = await showQuitConfirmDialog()

    if (confirmed) {
      isQuitting = true
      triggerSysProxy(false, false)
      await stopCore()
      app.exit()
    }
  } else if (notQuitDialog) {
    isQuitting = true
    triggerSysProxy(false, false)
    await stopCore()
    app.exit()
  }
})

powerMonitor.on('shutdown', async () => {
  triggerSysProxy(false, false)
  await stopCore()
  app.exit()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('crowvpn.app')
  try {
    await initPromise
  } catch (e) {
    dialog.showErrorBox('应用初始化失败', `${e}`)
    app.quit()
  }
  try {
    const [startPromise] = await startCore()
    startPromise.then(async () => {
      await initProfileUpdater()
    })
  } catch (e) {
    dialog.showErrorBox('内核启动出错', `${e}`)
  }
  try {
    await startMonitor()
  } catch {
    // ignore
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  const { showFloatingWindow: showFloating = false, disableTray = false } = await getAppConfig()
  registerIpcMainHandlers()
  
  // Register Xboard IPC handlers
  ipcMain.handle('xboard:login', async (_event, baseURL: string, email: string, password: string) => {
    try {
      const client = new XboardClient(baseURL)
      const authToken = await client.login({ email, password })
      console.log('[Main] Login successful, saving token:', authToken.substring(0, 20) + '...')
      setXboardConfig({ baseURL, token: authToken, email })
      return { success: true, token: authToken }
    } catch (error: any) {
      console.error('[Main] Login failed:', error.message)
      throw new Error(error.message || 'Login failed')
    }
  })

  ipcMain.handle('xboard:sendRegisterCode', async (_event, baseURL: string, email: string) => {
    try {
      const client = new XboardClient(baseURL)
      await client.sendEmailVerify(email)
      return { success: true }
    } catch (error: any) {
      console.error('[Main] Send register code failed:', error.message)
      throw new Error(error.message || 'Failed to send verification code')
    }
  })

  ipcMain.handle('xboard:register', async (_event, baseURL: string, email: string, password: string, inviteCode: string, emailCode: string) => {
    try {
      const client = new XboardClient(baseURL)
      await client.register({
        email,
        password,
        password_confirm: password, // V2Board API expects password_confirm
        email_code: emailCode,
        invite_code: inviteCode
      })
      return { success: true }
    } catch (error: any) {
      console.error('[Main] Register failed:', error.message)
      throw new Error(error.message || 'Registration failed')
    }
  })

  ipcMain.handle('xboard:sendResetCode', async (_event, baseURL: string, email: string) => {
    try {
      const client = new XboardClient(baseURL)
      await client.sendEmailVerify(email)
      return { success: true }
    } catch (error: any) {
      console.error('[Main] Send reset code failed:', error.message)
      throw new Error(error.message || 'Failed to send verification code')
    }
  })

  ipcMain.handle('xboard:resetPassword', async (_event, baseURL: string, email: string, emailCode: string, password: string) => {
    try {
      const client = new XboardClient(baseURL)
      await client.resetPassword({
        email,
        email_code: emailCode,
        password,
        password_confirm: password // V2Board API expects password_confirm
      })
      return { success: true }
    } catch (error: any) {
      console.error('[Main] Reset password failed:', error.message)
      throw new Error(error.message || 'Password reset failed')
    }
  })
  
  ipcMain.handle('xboard:logout', async () => {
    try {
      const config = getXboardConfig()
      if (config?.baseURL && config?.token) {
        const client = new XboardClient(config.baseURL)
        client.setAuthToken(config.token)
        await client.logout()
      }
      clearXboardConfig()
      return { success: true }
    } catch (error: any) {
      clearXboardConfig() // Clear anyway
      return { success: true }
    }
  })
  
  ipcMain.handle('xboard:getUserInfo', async () => {
    try {
      const config = getXboardConfig()
      console.log('[Main] getUserInfo - config:', config)
      if (!config?.baseURL || !config?.token) {
        throw new Error('Not logged in')
      }
      const client = new XboardClient(config.baseURL)
      client.setAuthToken(config.token)
      console.log('[Main] Created client, token set:', !!config.token)
      return await client.getUserInfo()
    } catch (error: any) {
      console.error('[Main] getUserInfo error:', error.message)
      throw error
    }
  })
  
  ipcMain.handle('xboard:getSubscribe', async () => {
    try {
      const config = getXboardConfig()
      console.log('[Main] getSubscribe - config:', config)
      if (!config?.baseURL || !config?.token) {
        throw new Error('Not logged in')
      }
      const client = new XboardClient(config.baseURL)
      client.setAuthToken(config.token)
      console.log('[Main] Created client, token set:', !!config.token)
      return await client.getSubscribe()
    } catch (error: any) {
      console.error('[Main] getSubscribe error:', error.message)
      throw error
    }
  })
  
  ipcMain.handle('xboard:getAnnouncements', async () => {
    try {
      const config = getXboardConfig()
      if (!config?.baseURL || !config?.token) {
        return []
      }
      const client = new XboardClient(config.baseURL)
      client.setAuthToken(config.token)
      return await client.getAnnouncements()
    } catch (error: any) {
      console.error('[Main] getAnnouncements error:', error.message)
      return []
    }
  })
  
  ipcMain.handle('xboard:checkLogin', () => {
    try {
      return { loggedIn: isLoggedIn(), config: getXboardConfig() }
    } catch (error: any) {
      console.error('[Main] checkLogin error:', error.message)
      return { loggedIn: false, config: null }
    }
  })
  
  ipcMain.handle('check-node-latency', async (_event, node) => {
    try {
      const { checkNodeLatency } = await import('./api/subscribe-parser')
      return await checkNodeLatency(node)
    } catch (error: any) {
      console.error('[Main] Check latency error:', error.message)
      return { ...node, status: 'offline' }
    }
  })

  ipcMain.handle('xboard:checkStatus', async () => {
    try {
      // Check if Mihomo core is running
      const http = await import('http')
      
      return new Promise((resolve) => {
        const req = http.get({
          hostname: '127.0.0.1',
          port: 9090,
          path: '/connections',
          timeout: 1000
        }, (res) => {
          res.on('data', () => {})
          res.on('end', () => {
            resolve({ connected: true, ip: '已连接', location: '代理中' })
          })
        })
        
        req.on('error', () => {
          resolve({ connected: false, ip: '', location: '' })
        })
        
        req.on('timeout', () => {
          req.destroy()
          resolve({ connected: false, ip: '', location: '' })
        })
      })
    } catch (error) {
      return { connected: false, ip: '', location: '' }
    }
  })

  // Update window title with connection status
  ipcMain.handle('ui:updateWindowTitle', async (_event, isConnected: boolean, title?: string) => {
    try {
      if (mainWindow) {
        if (title) {
          mainWindow.setTitle(title)
        } else {
          const status = isConnected ? '已连接' : '未连接'
          mainWindow.setTitle(`CrowVPN - ${status}`)
        }
        return { success: true }
      }
      return { success: false }
    } catch (error: any) {
      console.error('[Main] ui:updateWindowTitle error:', error?.message || error)
      return { success: false, message: error?.message || String(error) }
    }
  })

  ipcMain.handle('xboard:getNodes', async () => {
    try {
      const config = getXboardConfig()
      if (!config?.baseURL || !config?.token) {
        throw new Error('Not logged in')
      }
      const client = new XboardClient(config.baseURL)
      client.setAuthToken(config.token)
      
      console.log('[Main] Getting subscribe info...')
      const subscribe = await client.getSubscribe()
      console.log('[Main] Subscribe URL:', subscribe.subscribe_url)
      
      // Fetch and parse the actual subscribe
      const yamlText = await fetchSubscribe(subscribe.subscribe_url)
      const nodes = await parseClashYAML(yamlText)
      
      console.log('[Main] Returning', nodes.length, 'nodes immediately (status will be updated in UI)')
      
      return nodes
    } catch (error: any) {
      console.error('[Main] Get nodes error:', error.message)
      throw error
    }
  })

  // Open support chat window with relaxed CSP
  ipcMain.handle('ui:openSupport', async () => {
    try {
      const win = new BrowserWindow({
        width: 600,
        height: 700,
        resizable: true,
        minimizable: false,
        maximizable: false,
        title: '在线客服',
        modal: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: false
        }
      })
      // Position at bottom-right relative to main window if available
      try {
        const margin = 16
        if (mainWindow) {
          const b = mainWindow.getBounds()
          const x = Math.max(0, b.x + b.width - 600 - margin)
          const y = Math.max(0, b.y + b.height - 700 - margin)
          win.setPosition(x, y)
        } else {
          win.center()
        }
      } catch {}
      await win.loadURL('https://salesiq.zohopublic.com/signaturesupport.ls?widgetcode=siq661b3c690233e140e667eb2011f71bacbde8e0374600c18ca43af18d499fa838')
      // Try to scroll to chat area after load
      win.webContents.on('did-finish-load', () => {
        setTimeout(() => {
          try {
            win.webContents.executeJavaScript("window.scrollTo(0, document.body.scrollHeight)").catch(() => {})
          } catch {}
        }, 500)
      })
      win.show()
      return { success: true }
    } catch (e: any) {
      console.error('[Main] ui:openSupport error:', e?.message || e)
      return { success: false, message: e?.message || String(e) }
    }
  })

  ipcMain.handle('xboard:connect', async (_event, nodeName: string, mode: string = 'rule') => {
    try {
      console.log('[Main] Connecting to node:', nodeName, 'mode:', mode)
      
      const config = getXboardConfig()
      if (!config?.baseURL || !config?.token) {
        throw new Error('Not logged in')
      }
      
      const client = new XboardClient(config.baseURL)
      client.setAuthToken(config.token)
      
      // Get subscribe info
      const subscribe = await client.getSubscribe()
      const yamlText = await fetchSubscribe(subscribe.subscribe_url)
      
      // Parse YAML to find the selected node
      const doc = YAML.parse(yamlText)
      
      if (!doc || !Array.isArray(doc.proxies)) {
        throw new Error('No proxies found in subscribe')
      }
      
      // Find the selected node
      const selectedProxy = doc.proxies.find((p: any) => p.name === nodeName)
      if (!selectedProxy) {
        throw new Error(`Node ${nodeName} not found`)
      }
      
      console.log('[Main] Found selected node:', selectedProxy.name)
      
      // Save proxy state for unified config building
      setXboardProxyState({
        selectedNodeName: nodeName,
        mode: mode as 'rule' | 'global',
        proxies: doc.proxies,
        rules: mode === 'global' ? [] : [
          'DOMAIN-SUFFIX,local,DIRECT',
          'IP-CIDR,127.0.0.0/8,DIRECT',
          'IP-CIDR,172.16.0.0/12,DIRECT',
          'IP-CIDR,192.168.0.0/16,DIRECT',
          'IP-CIDR,10.0.0.0/8,DIRECT',
          'GEOIP,CN,DIRECT',
          `MATCH,${selectedProxy.name}`
        ]
      })
      
      console.log('[Main] Saved proxy state for mode:', mode)
      
      // Create a local profile for this connection
      const profileId = 'xboard-vpn'
      const { addProfileItem, getProfileConfig, setProfileStr } = await import('./config')
      
      // Check if profile already exists
      const profileConfig = await getProfileConfig()
      const existingProfile = profileConfig.items.find(p => p.id === profileId)
      
      if (!existingProfile) {
        // Create new profile
        await addProfileItem({
          id: profileId,
          name: 'Xboard VPN',
          type: 'local',
          url: ''
        })
      }
      
      // Build unified config using buildXboardConfig
      const unifiedConfig = await buildXboardConfig()
      console.log('[Main] Built unified config:', JSON.stringify(unifiedConfig))
      
      // Set the profile content
      const configStr = stringifyYaml(unifiedConfig)
      await setProfileStr(profileId, configStr)
      
      // Change to this profile
      const { changeCurrentProfile } = await import('./config')
      await changeCurrentProfile(profileId)
      
      // Start Mihomo core (already imported at top of file)
      await startCore()
      
      // Wait a bit for core to fully start
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Check TUN status: only enable system proxy if TUN is not enabled
      const { getControledMihomoConfig } = await import('./config/controledMihomo')
      const controledMihomoConfig = await getControledMihomoConfig()
      const tunEnabled = Boolean(controledMihomoConfig?.tun?.enable)
      
      console.log('[Main] TUN enabled:', tunEnabled)
      
      if (!tunEnabled) {
        // Enable system proxy (already imported at top of file)
        console.log('[Main] Enabling system proxy')
        await triggerSysProxy(true, false)
      } else {
        console.log('[Main] TUN is enabled, skipping system proxy')
      }
      
      console.log('[Main] VPN connected with mode:', mode)
      
      console.log('[Main] VPN connected successfully')
      
      // Update tray icon brightness
      await updateTrayIconBrightness(true)
      
      return { success: true }
    } catch (error: any) {
      console.error('[Main] Connect error:', error.message)
      throw error
    }
  })

  ipcMain.handle('xboard:disconnect', async () => {
    try {
      console.log('[Main] Disconnecting VPN...')
      
      // Stop Mihomo core (already imported at top of file)
      await stopCore()
      
      // Disable system proxy (already imported at top of file)
      await disableSysProxy(false)
      
      console.log('[Main] VPN disconnected successfully')
      
      // Update tray icon brightness
      await updateTrayIconBrightness(false)
      
      return { success: true }
    } catch (error: any) {
      console.error('[Main] Disconnect error:', error.message)
      throw error
    }
  })

  ipcMain.handle('xboard:switchMode', async (_event, mode: string) => {
    try {
      console.log('[Main] Switching to mode:', mode)
      
      // Update proxy state with new mode
      setXboardProxyState({ mode: mode as 'rule' | 'global' })
      console.log('[Main] Updated proxy state with mode:', mode)
      
      // Rebuild Xboard profile with unified config (including updated mode)
      console.log('[Main] Rebuilding Xboard profile with unified config')
      const profileId = 'xboard-vpn'
      const unifiedConfig = await buildXboardConfig()
      const configStr = stringifyYaml(unifiedConfig)
      const { setProfileStr } = await import('./config')
      await setProfileStr(profileId, configStr)
      console.log('[Main] Profile updated with unified config')
      
      // Restart core to apply (will call generateProfile to merge profile + controledMihomoConfig)
      console.log('[Main] Restarting core to apply mode changes')
      await stopCore()
      await startCore()
      console.log('[Main] Mode switched successfully')
      
      // Send notification
      new Notification({
        title: mode === 'global' ? '已切换至全局模式' : '已切换至规则模式'
      }).show()
      
      return { success: true }
    } catch (error: any) {
      console.error('[Main] Switch mode error:', error.message)
      throw new Error(error.message || 'Failed to switch mode')
    }
  })

  ipcMain.handle('xboard:switchNode', async (_event, nodeName: string) => {
    try {
      console.log('[Main] Switching to node:', nodeName)
      
      // First disconnect, then reconnect with new node
      console.log('[Main] Disconnecting first...')
      await stopCore()
      await disableSysProxy(false)
      
      // Wait a bit for clean shutdown
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Get subscription and create new config with new node
      const config = getXboardConfig()
      if (!config?.baseURL || !config?.token) {
        throw new Error('Not logged in')
      }
      
      const client = new XboardClient(config.baseURL)
      client.setAuthToken(config.token)
      
      const subscribe = await client.getSubscribe()
      const yamlText = await fetchSubscribe(subscribe.subscribe_url)
      const doc = YAML.parse(yamlText)
      
      if (!doc || !Array.isArray(doc.proxies)) {
        throw new Error('No proxies found in subscribe')
      }
      
      const selectedProxy = doc.proxies.find((p: any) => p.name === nodeName)
      if (!selectedProxy) {
        throw new Error(`Node ${nodeName} not found`)
      }
      
      console.log('[Main] Found new node:', selectedProxy.name)
      
      // Generate config with new node
      const minimalConfig: any = {
        port: 7890,
        'socks-port': 7891,
        'mixed-port': 7890,
        'allow-lan': true,
        mode: 'rule',
        'log-level': 'info',
        'external-controller': '127.0.0.1:9090',
        'secret': '',
        proxies: doc.proxies,
        proxy: selectedProxy.name,
        rules: [
          'DOMAIN-SUFFIX,local,DIRECT',
          'IP-CIDR,127.0.0.0/8,DIRECT',
          'IP-CIDR,172.16.0.0/12,DIRECT',
          'IP-CIDR,192.168.0.0/16,DIRECT',
          'IP-CIDR,10.0.0.0/8,DIRECT',
          'GEOIP,CN,DIRECT',
          `MATCH,${selectedProxy.name}`
        ]
      }
      
      // Update profile
      const profileId = 'xboard-vpn'
      const { setProfileStr } = await import('./config')
      const configStr = stringifyYaml(minimalConfig)
      await setProfileStr(profileId, configStr)
      
      // Change to this profile
      const { changeCurrentProfile } = await import('./config')
      await changeCurrentProfile(profileId)
      
      // Restart core with new config
      console.log('[Main] Reconnecting with new node...')
      await startCore()
      await triggerSysProxy(true, false)
      
      console.log('[Main] Node switched successfully by reconnecting')
      return { success: true }
    } catch (error: any) {
      console.error('[Main] Switch node error:', error.message || error.toString())
      throw error
    }
  })

  // TUN (virtual network card) toggle
  ipcMain.handle('xboard:setTun', async (_event, enable: boolean) => {
    try {
      const { patchControledMihomoConfig } = await import('./config/controledMihomo')
      const { patchMihomoConfig } = await import('./core/mihomoApi')
      console.log(`[Main] Setting TUN to ${enable}`)
      
      // Update controledMihomoConfig
      if (enable) {
        await patchControledMihomoConfig({ tun: { enable: true }, dns: { enable: true } }, false)
        console.log('[Main] TUN enabled, disabling system proxy')
        await triggerSysProxy(false, false)
      } else {
        await patchControledMihomoConfig({ tun: { enable: false } }, false)
        console.log('[Main] TUN disabled, re-enabling system proxy')
        await triggerSysProxy(true, false)
      }
      
      // Hot reload via API (no restart needed)
      const { getControledMihomoConfig } = await import('./config/controledMihomo')
      const controledMihomoConfig = await getControledMihomoConfig(true) // Force refresh from disk
      const { mihomoConfig } = await import('./core/mihomoApi')
      console.log('[Main] Patching Mihomo config via API for hot reload')
      
      try {
        // Get current runtime config to preserve other settings
        const currentRuntimeConfig = await mihomoConfig()
        // Merge TUN config into runtime config
        const updatedConfig = { ...currentRuntimeConfig, tun: controledMihomoConfig.tun as any }
        await patchMihomoConfig(updatedConfig)
        console.log('[Main] TUN configuration applied successfully via hot reload')
      } catch (error: any) {
        // If API is not available, configuration will be applied on next connection
        console.log('[Main] Core not running or API unavailable, will be applied on next connection')
      }
      
      // Notify renderer process
      mainWindow?.webContents.send('controledMihomoConfigUpdated')
      ipcMain.emit('updateTrayMenu')
      
      return { success: true }
    } catch (error: any) {
      console.error('[Main] setTun error:', error?.message || error)
      return { success: false, message: error?.message || String(error) }
    }
  })

  ipcMain.handle('xboard:getTun', async () => {
    try {
      const { getControledMihomoConfig } = await import('./config/controledMihomo')
      const conf = await getControledMihomoConfig()
      // @ts-ignore
      const enable = Boolean(conf?.tun?.enable)
      return { enable }
    } catch (error: any) {
      return { enable: false }
    }
  })

  // Get local IP address (legacy)
  ipcMain.handle('getLocalIP', () => {
    try {
      const { getBestLANIP } = require('./utils/net')
      const ip = getBestLANIP()
      console.log('[Main IPC] getLocalIP result:', ip)
      return { ip }
    } catch (error) {
      console.error('[Main IPC] getLocalIP error:', error)
      return { ip: '127.0.0.1' }
    }
  })

  // Get best LAN IP
  ipcMain.handle('net:getBestLanIP', () => {
    try {
      console.log('[Main IPC] net:getBestLanIP called')
      const os = require('os')
      const networkInterfaces = os.networkInterfaces()
      console.log('[Main IPC] Network interfaces:', Object.keys(networkInterfaces || {}))
      
      // Simple approach: just find first non-127.0.0.1, non-internal IPv4
      for (const [name, addrs] of Object.entries(networkInterfaces || {})) {
        if (!addrs) continue
        console.log(`[Main IPC] Checking interface ${name}`)
        
        for (const addr of addrs) {
          console.log(`[Main IPC]   Address: ${addr.address}, family: ${addr.family}, internal: ${addr.internal}`)
          if (addr.family === 'IPv4' && !addr.internal && addr.address !== '127.0.0.1' && !addr.address.startsWith('169.254.')) {
            console.log(`[Main IPC] Found LAN IP: ${addr.address}`)
            return { ip: addr.address }
          }
        }
      }
      
      console.log('[Main IPC] No LAN IP found, returning 127.0.0.1')
      return { ip: '127.0.0.1' }
    } catch (error) {
      console.error('[Main IPC] net:getBestLanIP error:', error)
      return { ip: '127.0.0.1' }
    }
  })

  // List all LAN IPs
  ipcMain.handle('net:listLanIPs', () => {
    try {
      console.log('[Main IPC] net:listLanIPs called')
      const os = require('os')
      const networkInterfaces = os.networkInterfaces()
      const result = []
      
      for (const [name, addrs] of Object.entries(networkInterfaces || {})) {
        if (!addrs) continue
        
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal && addr.address !== '127.0.0.1' && !addr.address.startsWith('169.254.')) {
            result.push({
              ip: addr.address,
              interface: name,
              family: 'IPv4',
              isPrivate: addr.address.startsWith('192.168.') || addr.address.startsWith('10.') || addr.address.match(/^172\.(1[6-9]|2\d|3[01])\./)
            })
          }
        }
      }
      
      console.log(`[Main IPC] Found ${result.length} LAN IPs`)
      return { ips: result }
    } catch (error) {
      console.error('[Main IPC] net:listLanIPs error:', error)
      return { ips: [] }
    }
  })
  
  await createWindow()
  if (showFloating) {
    showFloatingWindow()
  }
  if (!disableTray) {
    await createTray()
  }
  await initShortcut()
  
  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    showMainWindow()
  })
})

async function handleDeepLink(url: string): Promise<void> {
  if (!url.startsWith('clash://') && !url.startsWith('mihomo://') && !url.startsWith('sparkle://') && !url.startsWith('crowvpn://'))
    return

  const urlObj = new URL(url)
  switch (urlObj.host) {
    case 'install-config': {
      try {
        const profileUrl = urlObj.searchParams.get('url')
        const profileName = urlObj.searchParams.get('name')
        if (!profileUrl) {
          throw new Error('缺少参数 url')
        }

        const confirmed = await showProfileInstallConfirm(profileUrl, profileName)

        if (confirmed) {
          await addProfileItem({
            type: 'remote',
            name: profileName ?? undefined,
            url: profileUrl
          })
          mainWindow?.webContents.send('profileConfigUpdated')
          new Notification({ title: '订阅导入成功' }).show()
        }
      } catch (e) {
        dialog.showErrorBox('订阅导入失败', `${url}\n${e}`)
      }
      break
    }
    case 'install-override': {
      try {
        const urlParam = urlObj.searchParams.get('url')
        const profileName = urlObj.searchParams.get('name')
        if (!urlParam) {
          throw new Error('缺少参数 url')
        }

        const confirmed = await showOverrideInstallConfirm(urlParam, profileName)

        if (confirmed) {
          const url = new URL(urlParam)
          const name = url.pathname.split('/').pop()
          await addOverrideItem({
            type: 'remote',
            name: profileName ?? (name ? decodeURIComponent(name) : undefined),
            url: urlParam,
            ext: url.pathname.endsWith('.js') ? 'js' : 'yaml'
          })
          mainWindow?.webContents.send('overrideConfigUpdated')
          new Notification({ title: '覆写导入成功' }).show()
        }
      } catch (e) {
        dialog.showErrorBox('覆写导入失败', `${url}\n${e}`)
      }
      break
    }
  }
}

async function showProfileInstallConfirm(url: string, name?: string | null): Promise<boolean> {
  if (!mainWindow) {
    return false
  }
  let extractedName = name

  if (!extractedName) {
    try {
      const axios = (await import('axios')).default
      const response = await axios.head(url, {
        headers: {
          'User-Agent': await getUserAgent()
        },
        timeout: 5000,
        validateStatus: () => true
      })

      if (response.headers['content-disposition']) {
        extractedName = parseFilename(response.headers['content-disposition'])
      }
    } catch (error) {
      // ignore
    }
  }

  return new Promise((resolve) => {
    const delay = showWindow()
    setTimeout(() => {
      mainWindow?.webContents.send('show-profile-install-confirm', {
        url,
        name: extractedName || name
      })
      const handleConfirm = (_event: Electron.IpcMainEvent, confirmed: boolean): void => {
        ipcMain.off('profile-install-confirm-result', handleConfirm)
        resolve(confirmed)
      }
      ipcMain.once('profile-install-confirm-result', handleConfirm)
    }, delay)
  })
}

function parseFilename(str: string): string {
  if (str.match(/filename\*=.*''/)) {
    const filename = decodeURIComponent(str.split(/filename\*=.*''/)[1])
    return filename
  } else {
    const filename = str.split('filename=')[1]
    return filename?.replace(/"/g, '') || ''
  }
}

function showOverrideInstallConfirm(url: string, name?: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve(false)
      return
    }

    let finalName = name
    if (!finalName) {
      const urlObj = new URL(url)
      const pathName = urlObj.pathname.split('/').pop()
      finalName = pathName ? decodeURIComponent(pathName) : undefined
    }

    const delay = showWindow()
    setTimeout(() => {
      mainWindow?.webContents.send('show-override-install-confirm', {
        url,
        name: finalName
      })
      const handleConfirm = (_event: Electron.IpcMainEvent, confirmed: boolean): void => {
        ipcMain.off('override-install-confirm-result', handleConfirm)
        resolve(confirmed)
      }
      ipcMain.once('override-install-confirm-result', handleConfirm)
    }, delay)
  })
}

export async function createWindow(): Promise<void> {
  const { useWindowFrame = false } = await getAppConfig()
  const mainWindowState = windowStateKeeper({
    defaultWidth: 750,
    defaultHeight: 1200,
    file: 'window-state.json'
  })
  // https://github.com/electron/electron/issues/16521#issuecomment-582955104
  if (process.platform === 'darwin') {
    await createApplicationMenu()
  } else {
    Menu.setApplicationMenu(null)
  }
  mainWindow = new BrowserWindow({
    width: 600,
    height: 900,
    show: false,
    frame: process.platform === 'win32', // Use system frame on Windows
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    title: 'CrowVPN',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon: icon } : {}),
    ...(process.platform === 'win32' ? { icon: icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      spellcheck: false,
      sandbox: false
    }
  })
  mainWindowState.manage(mainWindow)
  
  // Set initial title
  mainWindow.setTitle('CrowVPN - 未连接')
  
  mainWindow.on('ready-to-show', async () => {
    const {
      silentStart = false,
      autoQuitWithoutCore = false,
      autoQuitWithoutCoreDelay = 60
    } = await getAppConfig()
    if (autoQuitWithoutCore && !mainWindow?.isVisible()) {
      if (quitTimeout) {
        clearTimeout(quitTimeout)
      }
      quitTimeout = setTimeout(async () => {
        await quitWithoutCore()
      }, autoQuitWithoutCoreDelay * 1000)
    }
    if (!silentStart) {
      if (quitTimeout) {
        clearTimeout(quitTimeout)
      }
      mainWindow?.show()
      mainWindow?.focusOnWebView()
    }
  })
  mainWindow.webContents.on('did-fail-load', () => {
    mainWindow?.webContents.reload()
  })

  mainWindow.on('close', async (event) => {
    event.preventDefault()
    mainWindow?.hide()
    const { autoQuitWithoutCore = false, autoQuitWithoutCoreDelay = 60 } = await getAppConfig()
    if (autoQuitWithoutCore) {
      if (quitTimeout) {
        clearTimeout(quitTimeout)
      }
      quitTimeout = setTimeout(async () => {
        await quitWithoutCore()
      }, autoQuitWithoutCoreDelay * 1000)
    }
  })

  mainWindow.on('move', () => {
    if (mainWindow) mainWindowState.saveState(mainWindow)
  })

  mainWindow.on('session-end', async () => {
    triggerSysProxy(false, false)
    await stopCore()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function triggerMainWindow(): void {
  if (mainWindow?.isVisible()) {
    closeMainWindow()
  } else {
    showMainWindow()
  }
}

export function showMainWindow(): void {
  if (mainWindow) {
    if (quitTimeout) {
      clearTimeout(quitTimeout)
    }
    mainWindow.show()
    mainWindow.focusOnWebView()
  }
}

export function closeMainWindow(): void {
  if (mainWindow) {
    mainWindow.close()
  }
}
