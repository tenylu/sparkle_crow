import { contextBridge, webUtils, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/**
 * Clean error message to remove English prefixes and stack traces
 * Returns only the Chinese error message
 */
function cleanErrorMessage(error: any, defaultMessage: string = '操作失败'): string {
  let errorMessage = error?.response?.data?.message || error?.message || defaultMessage
  
  // Remove Electron IPC error prefixes
  errorMessage = errorMessage.replace(/^Error occurred in handler for.*?Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/at\s+.*/g, '') // Remove stack trace lines
    .replace(/process\.processTicksAndRejections.*/g, '')
    .replace(/async Session\.<anonymous>.*/g, '')
    .trim()
  
  // If message is empty after cleaning, use default
  if (!errorMessage || errorMessage.length === 0) {
    errorMessage = defaultMessage
  }
  
  return errorMessage
}

// Custom APIs for renderer
const api = {
  webUtils: webUtils,
  getLocalIP: () => ipcRenderer.invoke('getLocalIP'),
  getPlatform: () => ipcRenderer.invoke('platform'),
  getVersion: () => ipcRenderer.invoke('getVersion'),
  net: {
    getBestLanIP: () => ipcRenderer.invoke('net:getBestLanIP'),
    listLanIPs: () => ipcRenderer.invoke('net:listLanIPs')
  },
  xboard: {
    login: async (baseURL: string, email: string, password: string) => {
      // IPC handler returns error object instead of throwing
      // This prevents Electron's automatic error logging "Error occurred in handler for..."
      // Return the result directly, let frontend handle the error
      return await ipcRenderer.invoke('xboard:login', baseURL, email, password)
    },
    logout: () =>
      ipcRenderer.invoke('xboard:logout'),
    getUserInfo: () =>
      ipcRenderer.invoke('xboard:getUserInfo'),
    getSubscribe: () =>
      ipcRenderer.invoke('xboard:getSubscribe'),
    getNodes: () =>
      ipcRenderer.invoke('xboard:getNodes'),
    getAnnouncements: () =>
      ipcRenderer.invoke('xboard:getAnnouncements'),
    checkLogin: () =>
      ipcRenderer.invoke('xboard:checkLogin'),
    connect: (nodeName: string, mode: string = 'rule') =>
      ipcRenderer.invoke('xboard:connect', nodeName, mode),
    disconnect: () =>
      ipcRenderer.invoke('xboard:disconnect'),
    switchNode: (nodeName: string) =>
      ipcRenderer.invoke('xboard:switchNode', nodeName),
    switchMode: (mode: string) =>
      ipcRenderer.invoke('xboard:switchMode', mode),
    checkStatus: () =>
      ipcRenderer.invoke('xboard:checkStatus'),
    setTun: (enable: boolean) =>
      ipcRenderer.invoke('xboard:setTun', enable),
    getTun: () =>
      ipcRenderer.invoke('xboard:getTun'),
    sendRegisterCode: async (baseURL: string, email: string) => {
      try {
        return await ipcRenderer.invoke('xboard:sendRegisterCode', baseURL, email)
      } catch (error: any) {
        throw new Error(cleanErrorMessage(error, '发送验证码失败'))
      }
    },
    register: async (baseURL: string, email: string, password: string, inviteCode: string, emailCode: string) => {
      try {
        return await ipcRenderer.invoke('xboard:register', baseURL, email, password, inviteCode, emailCode)
      } catch (error: any) {
        throw new Error(cleanErrorMessage(error, '注册失败'))
      }
    },
    sendResetCode: async (baseURL: string, email: string) => {
      try {
        return await ipcRenderer.invoke('xboard:sendResetCode', baseURL, email)
      } catch (error: any) {
        throw new Error(cleanErrorMessage(error, '发送验证码失败'))
      }
    },
    resetPassword: async (baseURL: string, email: string, emailCode: string, password: string) => {
      try {
        return await ipcRenderer.invoke('xboard:resetPassword', baseURL, email, emailCode, password)
      } catch (error: any) {
        throw new Error(cleanErrorMessage(error, '重置密码失败'))
      }
    }
  },
  ui: {
    openSupport: () => ipcRenderer.invoke('ui:openSupport'),
    updateWindowTitle: (isConnected: boolean, title?: string) => ipcRenderer.invoke('ui:updateWindowTitle', isConnected, title)
  },
  update: {
    checkUpdate: () => ipcRenderer.invoke('checkUpdate'),
    downloadAndInstallUpdate: (version: string) => ipcRenderer.invoke('downloadAndInstallUpdate', version),
    cancelUpdate: () => ipcRenderer.invoke('cancelUpdate'),
    getVersion: () => ipcRenderer.invoke('getVersion')
  },
  mihomo: {
    getConfig: () => ipcRenderer.invoke('getControledMihomoConfig')
  },
  sysproxy: {
    isHelperInstalled: () => ipcRenderer.invoke('isHelperInstalled'),
    installHelper: () => ipcRenderer.invoke('installHelper'),
    restartHelper: () => ipcRenderer.invoke('restartHelper')
  },
  onQuitConfirm: (callback: () => void) => {
    ipcRenderer.on('show-quit-confirm', callback)
    return () => {
      ipcRenderer.removeListener('show-quit-confirm', callback)
    }
  },
  sendQuitConfirmResult: (result: 'quit' | 'cancel' | 'minimize') => {
    ipcRenderer.send('quit-confirm-result', result)
  }
}
// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
