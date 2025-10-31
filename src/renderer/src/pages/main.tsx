import React, { useEffect, useState } from 'react'
import { useAppStore, type Node } from '../stores/useAppStore'
import { useTranslation } from '../hooks/useTranslation'
import { ConnectButton } from '../components/ConnectButton'
import { StatusCard } from '../components/StatusCard'
import { NodeSelector } from '../components/NodeSelector'
import { ProxyModeSelector } from '../components/ProxyModeSelector'
import { TunToggle } from '../components/TunToggle'
import { UserMenu } from '../components/UserMenu'
import { SettingsMenu } from '../components/SettingsMenu'
import { SharedProxyModal } from '../components/SharedProxyModal'
import { AnnouncementButton } from '../components/AnnouncementButton'
import { AnnouncementModal } from '../components/AnnouncementModal'
import logoImg from '../assets/logo.png'

interface MainProps {
  onLogout: () => void
}

const Main: React.FC<MainProps> = ({ onLogout }) => {
  const { 
    setUserInfo,
    setLocalIP, 
    setSelectedLanIP, 
    setLanIPs,
    showUserMenu,
    showSettingsMenu,
    setShowUserMenu,
    setShowSettingsMenu,
    showUpdateModal,
    setShowUpdateModal,
    updateInfo,
    isConnected,
    language
  } = useAppStore()
  const t = useTranslation()
  const [updateProgress, setUpdateProgress] = useState<{ downloading: boolean; progress: number } | null>(null)

  // Update window title when connection status or language changes
  useEffect(() => {
    const title = isConnected ? t('windowTitleConnected') : t('windowTitleDisconnected')
    window.api.ui.updateWindowTitle(isConnected, title).catch(console.error)
  }, [isConnected, language, t])

  // Listen for update progress
  useEffect(() => {
    const handleUpdateStatus = (_event: unknown, status: { downloading: boolean; progress: number }) => {
      setUpdateProgress(status)
    }
    
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on('update-status', handleUpdateStatus)
      return () => {
        window.electron.ipcRenderer.removeListener('update-status', handleUpdateStatus)
      }
    }
    return undefined
  }, [])

  useEffect(() => {
    const loadUserInfo = async () => {
      try {
        const info = await window.api.xboard.getUserInfo()
        setUserInfo(info)
      } catch (error) {
        console.error('Failed to load user info:', error)
      }
    }

    const loadNodes = async () => {
      try {
        console.log('[Main] Loading real nodes from API...')
        const realNodes = await window.api.xboard.getNodes()
        console.log('[Main] Got nodes:', realNodes)
        
        // Check if realNodes is an array
        if (!Array.isArray(realNodes)) {
          console.error('[Main] Invalid nodes data:', realNodes)
          useAppStore.getState().setNodes([])
          return
        }
        
        console.log('[Main] Got nodes count:', realNodes.length)
        
        const { setNodes, setSelectedNode, updateNode } = useAppStore.getState()
      
      // Map real nodes to our interface
      const mappedNodes = realNodes.map((node: Node) => ({
        name: node.name || 'Unknown',
        type: node.type || 'unknown',
        server: node.server || '',
        port: node.port || 0,
        country: node.country || 'XX',
        flag: node.flag || '🌐',
        latency: node.latency,
        status: node.status || 'checking'
      }))
      
      setNodes(mappedNodes)
        
        // Auto-select first node initially
        if (mappedNodes.length > 0) {
          console.log('[Main] Auto-selecting first node:', mappedNodes[0].name)
        setSelectedNode(mappedNodes[0])
      }

        // Async check latency and auto-select lowest latency node
        let completedCount = 0
        const totalNodes = mappedNodes.length
        
      mappedNodes.forEach((node, index) => {
        setTimeout(async () => {
          try {
            const { ipcRenderer } = window.electron
            const updatedNode = await ipcRenderer.invoke('check-node-latency', node)
              updateNode(node.name, updatedNode)
              
              completedCount++
              
              // When all checks complete, select the node with lowest latency
              if (completedCount === totalNodes) {
                console.log('[Main] All latency checks complete, selecting lowest latency node...')
                const currentState = useAppStore.getState()
                const onlineNodes = currentState.nodes.filter(n => n.status === 'online' && n.latency !== undefined)
                
                if (onlineNodes.length > 0) {
                  const sortedNodes = [...onlineNodes].sort((a, b) => {
                    const latA = a.latency || 999999
                    const latB = b.latency || 999999
                    return latA - latB
                  })
                  
                  const fastestNode = sortedNodes[0]
                  console.log('[Main] Selecting fastest node:', fastestNode.name, 'latency:', fastestNode.latency)
                  setSelectedNode(fastestNode)
                }
              }
            } catch (error) {
              completedCount++
              updateNode(node.name, { status: 'offline' })
              
              // Still check if all nodes processed
              if (completedCount === totalNodes) {
                const currentState = useAppStore.getState()
                const onlineNodes = currentState.nodes.filter(n => n.status === 'online' && n.latency !== undefined)
                
                if (onlineNodes.length > 0) {
                  const sortedNodes = [...onlineNodes].sort((a, b) => {
                    const latA = a.latency || 999999
                    const latB = b.latency || 999999
                    return latA - latB
                  })
                  
                  const fastestNode = sortedNodes[0]
                  setSelectedNode(fastestNode)
                }
              }
            }
          }, index * 50)
      })
    } catch (error) {
      console.error('[Main] Failed to load nodes:', error)
      }
    }

    const loadLANIPs = async () => {
      try {
        if (!window.api?.net) {
          console.warn('[Main UI] window.api.net not available, using fallback')
          setLocalIP('192.168.58.79')
          setSelectedLanIP('192.168.58.79')
          setLanIPs([{ ip: '192.168.58.79', interface: 'en0', family: 'IPv4' }])
      return
    }

        const res = await window.api.net.getBestLanIP()
        if (res?.ip && res.ip !== '127.0.0.1') {
          setLocalIP(res.ip)
          setSelectedLanIP(res.ip)
        } else {
          setLocalIP('192.168.58.79')
          setSelectedLanIP('192.168.58.79')
        }
        
        const ipsRes = await window.api.net.listLanIPs()
        if (ipsRes?.ips && ipsRes.ips.length > 0) {
          setLanIPs(ipsRes.ips)
          if (!res?.ip || res.ip === '127.0.0.1') {
            setSelectedLanIP(ipsRes.ips[0].ip)
            setLocalIP(ipsRes.ips[0].ip)
          }
        } else {
          setLanIPs([{ ip: '192.168.58.79', interface: 'en0', family: 'IPv4' }])
        }
      } catch (error) {
        console.error('[Main UI] Failed to get LAN IPs:', error)
        setLocalIP('192.168.58.79')
        setSelectedLanIP('192.168.58.79')
        setLanIPs([{ ip: '192.168.58.79', interface: 'en0', family: 'IPv4' }])
      }
    }

    loadUserInfo()
    loadNodes()
    loadLANIPs()
  }, [setUserInfo, setLocalIP, setSelectedLanIP, setLanIPs])

  return (
    <div className="w-full h-screen bg-gradient-to-b from-blue-50 via-indigo-50 to-white dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 -right-20 w-96 h-96 bg-blue-200 dark:bg-blue-900 rounded-full blur-3xl opacity-30 animate-pulse"></div>
        <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-indigo-200 dark:bg-indigo-900 rounded-full blur-3xl opacity-30 animate-pulse" style={{ animationDelay: '1s' }}></div>
      </div>

      {/* Main content */}
      <div className="relative w-full h-full flex flex-col">
        {/* Window Title Bar with title - draggable */}
        <div className="h-8 flex items-center justify-center px-6 relative" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {isConnected ? t('windowTitleConnected') : t('windowTitleDisconnected')}
          </span>
                </div>
                
        <div className="flex items-center justify-between px-6 py-4 relative z-[10000]" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <UserMenu onLogout={onLogout} />
          </div>
          
          <div className="relative flex items-center space-x-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <AnnouncementButton />
            <SettingsMenu />
          </div>
        </div>
        
        {/* Click outside to close menus */}
        {(showUserMenu || showSettingsMenu) && (
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => {
              setShowUserMenu(false)
              setShowSettingsMenu(false)
            }}
          ></div>
        )}
        
        <SharedProxyModal />
        <AnnouncementModal />
        
        {/* Update Modal */}
        {showUpdateModal && updateInfo && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]"
              onClick={() => setShowUpdateModal(false)}
            ></div>
            
            {/* Modal */}
            <div className="fixed inset-0 flex items-center justify-center z-[101] px-4">
              <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl max-w-md w-full overflow-hidden">
                {/* Header */}
                <div className="p-6 pb-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-xl overflow-hidden">
                    <img src={logoImg} alt="CrowVPN Logo" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                      发现新版本
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      版本 {updateInfo.version}
                    </p>
                  </div>
                </div>
                </div>
                
                {/* Content */}
                <div className="p-6">
                  {updateProgress?.downloading ? (
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          {updateProgress.progress === 0 ? '正在安装...' : '下载中...'}
                        </h4>
                        <span className="text-sm text-blue-600 dark:text-blue-400">
                          {updateProgress.progress === 0 ? '' : `${updateProgress.progress}%`}
                        </span>
                      </div>
                      {updateProgress.progress === 0 ? (
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                          <div className="bg-blue-500 h-full animate-pulse"></div>
                        </div>
                      ) : (
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                          <div 
                            className="bg-blue-500 h-full transition-all duration-300 ease-out"
                            style={{ width: `${updateProgress.progress}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mb-6">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        更新内容：
                      </h4>
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 max-h-48 overflow-y-auto">
                        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                          {updateInfo.changelog}
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {/* Buttons */}
                  <div className="flex space-x-3">
                    <button
                      onClick={() => {
                        if (!updateProgress?.downloading) {
                          setShowUpdateModal(false)
                        }
                      }}
                      disabled={updateProgress?.downloading}
                      className="flex-1 py-3 rounded-xl font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      取消
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await window.api.update.downloadAndInstallUpdate(updateInfo.version)
                          // 下载完成后会自动安装并重启
                        } catch (err: unknown) {
                          const errorMessage = err instanceof Error ? err.message : '未知错误'
                          alert('更新失败：' + errorMessage)
                          setShowUpdateModal(false)
                        }
                      }}
                      disabled={updateProgress?.downloading}
                      className="flex-1 py-3 rounded-xl font-semibold text-white bg-blue-500 hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {updateProgress?.downloading ? (updateProgress.progress === 0 ? '安装中...' : '下载中...') : '立即更新'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Central area - z-0 so they're behind the no-plan modal */}
        <div className="absolute top-[10%] left-0 right-0 flex flex-col items-center space-y-6 z-0">
          <ConnectButton />
          <StatusCard />
        </div>

        {/* Spacer */}
        <div className="flex-1"></div>

        {/* Bottom controls - z-0 so they're behind the no-plan modal */}
        <div className="absolute bottom-0 left-0 right-0 p-6 space-y-3 z-0">
          <NodeSelector />
          <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-3xl shadow-2xl p-4">
            <div className="grid grid-cols-2 gap-3">
              <ProxyModeSelector />
              <TunToggle />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Main

