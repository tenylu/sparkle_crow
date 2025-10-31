import { contextBridge, webUtils, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  webUtils: webUtils,
  getLocalIP: () => ipcRenderer.invoke('getLocalIP'),
  net: {
    getBestLanIP: () => ipcRenderer.invoke('net:getBestLanIP'),
    listLanIPs: () => ipcRenderer.invoke('net:listLanIPs')
  },
  xboard: {
    login: (baseURL: string, email: string, password: string) =>
      ipcRenderer.invoke('xboard:login', baseURL, email, password),
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
    sendRegisterCode: (baseURL: string, email: string) =>
      ipcRenderer.invoke('xboard:sendRegisterCode', baseURL, email),
    register: (baseURL: string, email: string, password: string, inviteCode: string, emailCode: string) =>
      ipcRenderer.invoke('xboard:register', baseURL, email, password, inviteCode, emailCode),
    sendResetCode: (baseURL: string, email: string) =>
      ipcRenderer.invoke('xboard:sendResetCode', baseURL, email),
    resetPassword: (baseURL: string, email: string, emailCode: string, password: string) =>
      ipcRenderer.invoke('xboard:resetPassword', baseURL, email, emailCode, password)
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
