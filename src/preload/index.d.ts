import { ElectronAPI } from '@electron-toolkit/preload'
import { webUtils } from 'electron'
import type { UserInfo, SubscribeInfo } from '../../shared/types/xboard'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      webUtils: typeof webUtils
      getLocalIP: () => Promise<{ ip: string }>
      getPlatform: () => Promise<NodeJS.Platform>
      getVersion: () => Promise<string>
      net: {
        getBestLanIP: () => Promise<{ ip: string }>
        listLanIPs: () => Promise<{ ips: Array<{ ip: string, interface: string, family: 'IPv4' | 'IPv6', isPrivate?: boolean, isULA?: boolean }> }>
      }
      xboard: {
        login: (baseURL: string, email: string, password: string) => Promise<{ success: boolean, token?: string, baseURL?: string, error?: string }>
        logout: () => Promise<{ success: boolean }>
        getUserInfo: () => Promise<UserInfo>
        getSubscribe: () => Promise<SubscribeInfo>
        getNodes: () => Promise<any[]>
        getAnnouncements: () => Promise<Array<{ id: number; title: string; content: string; created_at: number }>>
        checkLogin: () => Promise<{ loggedIn: boolean, config: any }>
        connect: (nodeName: string, mode?: string) => Promise<{ success: boolean }>
        disconnect: () => Promise<{ success: boolean }>
        switchNode: (nodeName: string) => Promise<{ success: boolean }>
        switchMode: (mode: string) => Promise<{ success: boolean }>
        checkStatus: () => Promise<{ connected: boolean, ip: string, location: string }>
        setTun: (enable: boolean) => Promise<{ success: boolean, message?: string }>
        getTun: () => Promise<{ enable: boolean }>
        sendRegisterCode: (baseURL: string, email: string) => Promise<{ success: boolean, baseURL?: string, error?: string }>
        register: (baseURL: string, email: string, password: string, inviteCode: string, emailCode: string) => Promise<{ success: boolean, baseURL?: string, error?: string }>
        sendResetCode: (baseURL: string, email: string) => Promise<{ success: boolean, baseURL?: string, error?: string }>
        resetPassword: (baseURL: string, email: string, emailCode: string, password: string) => Promise<{ success: boolean, baseURL?: string, error?: string }>
      }
      ui: {
        openSupport: () => Promise<{ success: boolean; message?: string }>
        updateWindowTitle: (isConnected: boolean, title?: string) => Promise<{ success: boolean; message?: string }>
      }
      update: {
        checkUpdate: () => Promise<any>
        downloadAndInstallUpdate: (version: string) => Promise<void>
        cancelUpdate: () => Promise<void>
        getVersion: () => Promise<string>
      }
      mihomo: {
        getConfig: () => Promise<any>
      }
      sysproxy: {
        isHelperInstalled: () => Promise<boolean>
        installHelper: () => Promise<void>
        restartHelper: () => Promise<void>
      }
      onQuitConfirm: (callback: () => void) => () => void
      sendQuitConfirmResult: (result: 'quit' | 'cancel' | 'minimize') => void
    }
  }
}

      sendQuitConfirmResult: (result: 'quit' | 'cancel' | 'minimize') => void
    }
  }
}

      sendQuitConfirmResult: (result: 'quit' | 'cancel' | 'minimize') => void
    }
  }
}

      sendQuitConfirmResult: (result: 'quit' | 'cancel' | 'minimize') => void
    }
  }
}
