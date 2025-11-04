import { create } from 'zustand'
import type { UserInfo } from '../../../shared/types/xboard'

export interface Node {
  name: string
  type: string
  server: string
  port: number
  country: string
  flag: string
  latency?: number
  status?: 'unknown' | 'online' | 'offline' | 'checking'
}

export type ProxyMode = 'rule' | 'global'
export type AppTheme = 'auto' | 'light' | 'dark'

interface AppState {
  // User state
  userInfo: UserInfo | null
  setUserInfo: (info: UserInfo | null) => void
  
  // Connection state
  isConnected: boolean
  setIsConnected: (connected: boolean) => void
  isConnecting: boolean
  setIsConnecting: (connecting: boolean) => void
  isDisconnecting: boolean
  setIsDisconnecting: (disconnecting: boolean) => void
  
  // Nodes state
  nodes: Node[]
  setNodes: (nodes: Node[]) => void
  updateNode: (name: string, updates: Partial<Node>) => void
  selectedNode: Node | null
  setSelectedNode: (node: Node | null) => void
  nodesLoading: boolean
  setNodesLoading: (loading: boolean) => void
  autoSelectNode: boolean
  setAutoSelectNode: (auto: boolean) => void
  
  // Proxy mode
  proxyMode: ProxyMode
  setProxyMode: (mode: ProxyMode) => void
  
  // Connection status
  connectionStatus: {
    ip: string
    location: string
  }
  setConnectionStatus: (status: { ip: string; location: string }) => void
  
  // UI state
  showNodeList: boolean
  setShowNodeList: (show: boolean) => void
  showUserMenu: boolean
  setShowUserMenu: (show: boolean) => void
  showSettingsMenu: boolean
  setShowSettingsMenu: (show: boolean) => void
  showSharedProxyModal: boolean
  setShowSharedProxyModal: (show: boolean) => void
  showAnnouncementModal: boolean
  setShowAnnouncementModal: (show: boolean) => void
  hasUnreadAnnouncements: boolean
  setHasUnreadAnnouncements: (hasUnread: boolean) => void
  showUpdateModal: boolean
  setShowUpdateModal: (show: boolean) => void
  updateInfo: { version: string; changelog: string } | null
  setUpdateInfo: (info: { version: string; changelog: string } | null) => void
  hasUpdateAvailable: boolean
  setHasUpdateAvailable: (hasUpdate: boolean) => void
  language: 'zh' | 'en'
  setLanguage: (lang: 'zh' | 'en') => void
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
  
  // LAN IP
  localIP: string
  setLocalIP: (ip: string) => void
  selectedLanIP: string
  setSelectedLanIP: (ip: string) => void
  lanIPs: Array<{ ip: string; interface: string; family: 'IPv4' | 'IPv6' }>
  setLanIPs: (ips: Array<{ ip: string; interface: string; family: 'IPv4' | 'IPv6' }>) => void
  
  // Reset
  reset: () => void
}

// Get initial language from localStorage or default to 'zh'
const getInitialLanguage = (): 'zh' | 'en' => {
  try {
    const saved = localStorage.getItem('app_language')
    if (saved === 'zh' || saved === 'en') {
      return saved
    }
  } catch {
    // ignore
  }
  return 'zh'
}

// Get initial theme from localStorage or default to 'auto'
const getInitialTheme = (): AppTheme => {
  try {
    const saved = localStorage.getItem('app_theme')
    if (saved === 'auto' || saved === 'light' || saved === 'dark') {
      return saved
    }
  } catch {
    // ignore
  }
  return 'auto'
}

const getInitialAutoSelect = (): boolean => {
  try {
    const saved = localStorage.getItem('auto_select_node')
    return saved !== 'false' // Default to true
  } catch {
    return true
  }
}

const initialState = {
  userInfo: null,
  isConnected: false,
  isConnecting: false,
  isDisconnecting: false,
  nodes: [],
  selectedNode: null,
  proxyMode: 'rule' as ProxyMode,
  connectionStatus: { ip: '未连接', location: '未连接' },
  showNodeList: false,
  showUserMenu: false,
  showSettingsMenu: false,
  showSharedProxyModal: false,
  showAnnouncementModal: false,
  hasUnreadAnnouncements: false,
  showUpdateModal: false,
  updateInfo: null,
  hasUpdateAvailable: false,
  language: getInitialLanguage(),
  theme: getInitialTheme(),
  localIP: '',
  selectedLanIP: '',
  lanIPs: [],
  nodesLoading: false,
  autoSelectNode: getInitialAutoSelect()
}

export const useAppStore = create<AppState>((set) => {
  // Apply initial theme
  const initialTheme = getInitialTheme()
  const root = document.documentElement
  if (initialTheme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  } else {
    root.classList.toggle('dark', initialTheme === 'dark')
  }
  
  return {
    ...initialState,
  
    setUserInfo: (info) => set({ userInfo: info }),
  setIsConnected: (connected) => set({ isConnected: connected }),
  setIsConnecting: (connecting) => set({ isConnecting: connecting }),
  setIsDisconnecting: (disconnecting) => set({ isDisconnecting: disconnecting }),
  
  setNodes: (nodes) => {
    console.log('[Store] setNodes called with:', nodes?.length, 'nodes')
    set({ nodes: Array.isArray(nodes) ? nodes : [] })
  },
  updateNode: (name, updates) =>
    set((state) => {
      console.log('[Store] updateNode called:', name, updates)
      return {
        nodes: Array.isArray(state.nodes) ? state.nodes.map((node) =>
          node.name === name ? { ...node, ...updates } : node
        ) : []
      }
    }),
  setSelectedNode: (node) => {
    console.log('[Store] setSelectedNode called with:', node?.name || 'null')
    set({ selectedNode: node })
  },
  
  setProxyMode: (mode) => set({ proxyMode: mode }),
  
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  
  setShowNodeList: (show) => set({ showNodeList: show }),
  setShowUserMenu: (show) => set({ showUserMenu: show }),
  setShowSettingsMenu: (show) => set({ showSettingsMenu: show }),
  setShowSharedProxyModal: (show) => set({ showSharedProxyModal: show }),
  setShowAnnouncementModal: (show) => set({ showAnnouncementModal: show }),
  setHasUnreadAnnouncements: (hasUnread) => set({ hasUnreadAnnouncements: hasUnread }),
  setShowUpdateModal: (show) => set({ showUpdateModal: show }),
  setUpdateInfo: (info) => set({ updateInfo: info }),
  setHasUpdateAvailable: (hasUpdate) => set({ hasUpdateAvailable: hasUpdate }),
  setLanguage: (lang) => {
    try {
      localStorage.setItem('app_language', lang)
    } catch {
      // ignore
    }
    set({ language: lang })
  },
  setTheme: (theme) => {
    try {
      localStorage.setItem('app_theme', theme)
    } catch {
      // ignore
    }
    set({ theme })
    // Apply theme class to document
    const root = document.documentElement
    if (theme === 'auto') {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      root.classList.toggle('dark', prefersDark)
    } else {
      root.classList.toggle('dark', theme === 'dark')
    }
  },
  
  setLocalIP: (ip) => set({ localIP: ip }),
  setSelectedLanIP: (ip) => set({ selectedLanIP: ip }),
  setLanIPs: (ips) => set({ lanIPs: ips }),
  
    setNodesLoading: (loading) => set({ nodesLoading: loading }),
  
    setAutoSelectNode: (auto) => {
      try {
        localStorage.setItem('auto_select_node', String(auto))
      } catch {
        // ignore
      }
      set({ autoSelectNode: auto })
    },
  
    reset: () => set(initialState)
  }
})

