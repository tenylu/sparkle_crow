import { app, globalShortcut, ipcMain, Notification } from 'electron'
import { mainWindow, setNotQuitDialog, triggerMainWindow } from '..'
import {
  getAppConfig,
  getControledMihomoConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import { triggerSysProxy } from '../sys/sysproxy'
import { patchMihomoConfig } from '../core/mihomoApi'
import { quitWithoutCore, restartCore } from '../core/manager'
import { floatingWindow, triggerFloatingWindow } from './floatingWindow'

export async function registerShortcut(
  oldShortcut: string,
  newShortcut: string,
  action: string
): Promise<boolean> {
  if (oldShortcut !== '') {
    globalShortcut.unregister(oldShortcut)
  }
  if (newShortcut === '') {
    return true
  }
  switch (action) {
    case 'showWindowShortcut': {
      return globalShortcut.register(newShortcut, () => {
        triggerMainWindow()
      })
    }
    case 'showFloatingWindowShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        await triggerFloatingWindow()
      })
    }
    case 'triggerSysProxyShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        const {
          sysProxy: { enable },
          onlyActiveDevice = false
        } = await getAppConfig()
        try {
          await triggerSysProxy(!enable, onlyActiveDevice)
          await patchAppConfig({ sysProxy: { enable: !enable } })
          new Notification({
            title: `系统代理已${!enable ? '开启' : '关闭'}`
          }).show()
          mainWindow?.webContents.send('appConfigUpdated')
          floatingWindow?.webContents.send('appConfigUpdated')
        } catch {
          // ignore
        } finally {
          ipcMain.emit('updateTrayMenu')
        }
      })
    }
    case 'triggerTunShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        const { tun } = await getControledMihomoConfig()
        const enable = tun?.enable ?? false
        try {
          if (!enable) {
            await patchControledMihomoConfig({ tun: { enable: !enable }, dns: { enable: true } })
          } else {
            await patchControledMihomoConfig({ tun: { enable: !enable } })
          }
          await restartCore()
          new Notification({
            title: `虚拟网卡已${!enable ? '开启' : '关闭'}`
          }).show()
          mainWindow?.webContents.send('controledMihomoConfigUpdated')
          floatingWindow?.webContents.send('appConfigUpdated')
        } catch {
          // ignore
        } finally {
          ipcMain.emit('updateTrayMenu')
        }
      })
    }
    case 'ruleModeShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        try {
          // Update proxy state
          const { setXboardProxyState, getXboardProxyState } = await import('../config/xboard')
          setXboardProxyState({ mode: 'rule' })
          
          // Update config files
          await patchControledMihomoConfig({ mode: 'rule' }, false)
          
          // Get proxy state to build rules
          const proxyState = getXboardProxyState()
          
          // Build rules for rule mode
          let rules: string[] = []
          if (proxyState?.selectedNodeName) {
            rules = [
              'DOMAIN-SUFFIX,local,DIRECT',
              'IP-CIDR,127.0.0.0/8,DIRECT',
              'IP-CIDR,172.16.0.0/12,DIRECT',
              'IP-CIDR,192.168.0.0/16,DIRECT',
              'IP-CIDR,10.0.0.0/8,DIRECT',
              'GEOIP,CN,DIRECT',
              `MATCH,${proxyState.selectedNodeName}`
            ]
          }
          
          // Hot-reload via API (no restart, no reconnection)
          await patchMihomoConfig({ mode: 'rule', rules: rules })
          new Notification({
            title: '已切换至规则模式'
          }).show()
          mainWindow?.webContents.send('controledMihomoConfigUpdated')
          ipcMain.emit('updateTrayMenu')
        } catch (error) {
          console.error('[Shortcut] Failed to switch to rule mode:', error)
        }
      })
    }
    case 'globalModeShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        try {
          // Update proxy state
          const { setXboardProxyState, getXboardProxyState } = await import('../config/xboard')
          setXboardProxyState({ mode: 'global' })
          
          // Update config files
          await patchControledMihomoConfig({ mode: 'global' }, false)
          
          // Get proxy state to build rules
          const proxyState = getXboardProxyState()
          if (!proxyState?.selectedNodeName) {
            console.error('[Shortcut] No proxy selected for global mode')
            return
          }
          
          // Global mode: all traffic goes through proxy (only local traffic is direct)
          const rules = [
            'DOMAIN-SUFFIX,local,DIRECT',
            'IP-CIDR,127.0.0.0/8,DIRECT',
            'IP-CIDR,172.16.0.0/12,DIRECT',
            'IP-CIDR,192.168.0.0/16,DIRECT',
            'IP-CIDR,10.0.0.0/8,DIRECT',
            `MATCH,${proxyState.selectedNodeName}`
          ]
          
          // Hot-reload via API (no restart, no reconnection)
          await patchMihomoConfig({ mode: 'global', rules: rules })
          new Notification({
            title: '已切换至全局模式'
          }).show()
          mainWindow?.webContents.send('controledMihomoConfigUpdated')
          ipcMain.emit('updateTrayMenu')
        } catch (error) {
          console.error('[Shortcut] Failed to switch to global mode:', error)
        }
      })
    }
    case 'directModeShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        try {
          // Update proxy state
          const { setXboardProxyState } = await import('../config/xboard')
          setXboardProxyState({ mode: 'direct' })
          
          // Update config files
          await patchControledMihomoConfig({ mode: 'direct' }, false)
          
          // Hot-reload via API (no restart, no reconnection)
          await patchMihomoConfig({ mode: 'direct', rules: [] })
          new Notification({
            title: '已切换至直连模式'
          }).show()
          mainWindow?.webContents.send('controledMihomoConfigUpdated')
          ipcMain.emit('updateTrayMenu')
        } catch (error) {
          console.error('[Shortcut] Failed to switch to direct mode:', error)
        }
      })
    }
    case 'quitWithoutCoreShortcut': {
      return globalShortcut.register(newShortcut, async () => {
        setNotQuitDialog()
        await quitWithoutCore()
      })
    }
    case 'restartAppShortcut': {
      return globalShortcut.register(newShortcut, () => {
        setNotQuitDialog()
        app.relaunch()
        app.quit()
      })
    }
  }
  throw new Error('Unknown action')
}

export async function initShortcut(): Promise<void> {
  const {
    showFloatingWindowShortcut,
    showWindowShortcut,
    triggerSysProxyShortcut,
    triggerTunShortcut,
    ruleModeShortcut,
    globalModeShortcut,
    directModeShortcut,
    quitWithoutCoreShortcut,
    restartAppShortcut
  } = await getAppConfig()
  if (showWindowShortcut) {
    try {
      await registerShortcut('', showWindowShortcut, 'showWindowShortcut')
    } catch {
      // ignore
    }
  }
  if (showFloatingWindowShortcut) {
    try {
      await registerShortcut('', showFloatingWindowShortcut, 'showFloatingWindowShortcut')
    } catch {
      // ignore
    }
  }
  if (triggerSysProxyShortcut) {
    try {
      await registerShortcut('', triggerSysProxyShortcut, 'triggerSysProxyShortcut')
    } catch {
      // ignore
    }
  }
  if (triggerTunShortcut) {
    try {
      await registerShortcut('', triggerTunShortcut, 'triggerTunShortcut')
    } catch {
      // ignore
    }
  }
  if (ruleModeShortcut) {
    try {
      await registerShortcut('', ruleModeShortcut, 'ruleModeShortcut')
    } catch {
      // ignore
    }
  }
  if (globalModeShortcut) {
    try {
      await registerShortcut('', globalModeShortcut, 'globalModeShortcut')
    } catch {
      // ignore
    }
  }
  if (directModeShortcut) {
    try {
      await registerShortcut('', directModeShortcut, 'directModeShortcut')
    } catch {
      // ignore
    }
  }
  if (quitWithoutCoreShortcut) {
    try {
      await registerShortcut('', quitWithoutCoreShortcut, 'quitWithoutCoreShortcut')
    } catch {
      // ignore
    }
  }
  if (restartAppShortcut) {
    try {
      await registerShortcut('', restartAppShortcut, 'restartAppShortcut')
    } catch {
      // ignore
    }
  }
}
