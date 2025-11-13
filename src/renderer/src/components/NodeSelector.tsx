import React from 'react'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../hooks/useTranslation'

export const NodeSelector: React.FC = () => {
  const t = useTranslation()
  const { 
    showNodeList, 
    setShowNodeList, 
    selectedNode,
    nodes,
    setNodes,
    updateNode,
    setSelectedNode,
    isConnected,
    setIsConnecting,
    nodesLoading,
    setNodesLoading,
    autoSelectNode,
    setAutoSelectNode
  } = useAppStore()

  const handleSwitchNode = async (newNode: typeof selectedNode | 'auto') => {
    if (newNode === 'auto') {
      // Handle auto-select option
      setAutoSelectNode(true)
      // If auto-select is enabled, automatically select the fastest node
      const currentState = useAppStore.getState()
      const onlineNodes = currentState.nodes.filter(n => n.status === 'online' && n.latency !== undefined)
      
      if (onlineNodes.length > 0) {
        const sortedNodes = [...onlineNodes].sort((a, b) => {
          const latA = a.latency || 999999
          const latB = b.latency || 999999
          return latA - latB
        })
        
        const fastestNode = sortedNodes[0]
        if (!isConnected) {
          setSelectedNode(fastestNode)
        } else {
          setIsConnecting(true)
          try {
            await window.api.xboard.switchNode(fastestNode.name)
            setSelectedNode(fastestNode)
          } catch (error: any) {
            console.error('Failed to switch node:', error)
            alert(error.message || t('switchNodeFailed'))
          } finally {
            setIsConnecting(false)
          }
        }
      }
      return
    }

    if (!newNode) return

    // Disable auto-select when manually selecting a node
    setAutoSelectNode(false)

    if (!isConnected) {
      // Not connected, just update selection
      setSelectedNode(newNode)
      return
    }

    // Connected, switch the node
    setIsConnecting(true)
    try {
      console.log('Switching to node:', newNode.name)
      await window.api.xboard.switchNode(newNode.name)
      setSelectedNode(newNode)
    } catch (error: any) {
      console.error('Failed to switch node:', error)
      alert(error.message || t('switchNodeFailed'))
    } finally {
      setIsConnecting(false)
    }
  }

  const loadNodes = async () => {
    setNodesLoading(true)
    try {
      console.log('[NodeSelector] Loading real nodes from API...')
      const realNodes = await window.api.xboard.getNodes()
      console.log('[NodeSelector] Got nodes:', realNodes)
      
      // Check if realNodes is an array
      if (!Array.isArray(realNodes)) {
        console.error('[NodeSelector] Invalid nodes data:', realNodes)
        setNodes([])
        return
      }
      
      console.log('[NodeSelector] Got nodes count:', realNodes.length)
      
      // Map real nodes to our interface and filter out Shadowsocks nodes
      const mappedNodes = realNodes
        .map((node: any) => ({
          name: node.name || 'Unknown',
          type: node.type || 'unknown',
          server: node.server || '',
          port: node.port || 0,
          country: node.country || 'XX',
          flag: node.flag || '🌐',
          latency: node.latency,
          status: node.status || 'checking'
        }))
        .filter((node: any) => {
          // Hide Shadowsocks nodes
          const nodeType = (node.type || '').toLowerCase()
          return nodeType !== 'shadowsocks' && nodeType !== 'ss'
        })
      
      console.log('[NodeSelector] Mapped nodes (after filtering Shadowsocks):', mappedNodes.length, mappedNodes)
      setNodes(mappedNodes)

      // Async check latency for all nodes
      let completedCount = 0
      const totalNodes = mappedNodes.length
      
      mappedNodes.forEach((node, index) => {
        setTimeout(async () => {
          try {
            const { ipcRenderer } = window.electron
            const updatedNode = await ipcRenderer.invoke('check-node-latency', node)
            updateNode(node.name, updatedNode)
            
            completedCount++
            console.log(`[NodeSelector] Completed ${completedCount}/${totalNodes} latency checks`)
            
            // When all checks complete, if auto-select is enabled, select the node with lowest latency
            if (completedCount === totalNodes) {
              console.log('[NodeSelector] All latency checks complete')
              const currentState = useAppStore.getState()
              
              // Only auto-select if autoSelectNode is enabled
              if (currentState.autoSelectNode) {
                const onlineNodes = currentState.nodes.filter(n => n.status === 'online' && n.latency !== undefined)
                
                if (onlineNodes.length > 0) {
                  // Sort by latency and select the fastest
                  const sortedNodes = [...onlineNodes].sort((a, b) => {
                    const latA = a.latency || 999999
                    const latB = b.latency || 999999
                    return latA - latB
                  })
                  
                  const fastestNode = sortedNodes[0]
                  console.log('[NodeSelector] Auto-selecting fastest node:', fastestNode.name, 'latency:', fastestNode.latency)
                  setSelectedNode(fastestNode)
                } else {
                  console.log('[NodeSelector] No online nodes found, keeping current selection')
                }
              } else {
                console.log('[NodeSelector] Auto-select is disabled, keeping current selection')
              }
            }
          } catch (error) {
            completedCount++
            updateNode(node.name, { status: 'offline' })
            console.log(`[NodeSelector] Completed ${completedCount}/${totalNodes} (node failed)`)
            
            // Still check if all nodes processed
            if (completedCount === totalNodes) {
              console.log('[NodeSelector] All latency checks complete (with failures)')
              const currentState = useAppStore.getState()
              
              // Only auto-select if autoSelectNode is enabled
              if (currentState.autoSelectNode) {
                const onlineNodes = currentState.nodes.filter(n => n.status === 'online' && n.latency !== undefined)
                
                if (onlineNodes.length > 0) {
                  const sortedNodes = [...onlineNodes].sort((a, b) => {
                    const latA = a.latency || 999999
                    const latB = b.latency || 999999
                    return latA - latB
                  })
                  
                  const fastestNode = sortedNodes[0]
                  console.log('[NodeSelector] Auto-selecting fastest node:', fastestNode.name, 'latency:', fastestNode.latency)
                  setSelectedNode(fastestNode)
                }
              }
            }
          }
        }, index * 50)
      })
    } catch (error) {
      console.error('[NodeSelector] Failed to load nodes:', error)
    } finally {
      setNodesLoading(false)
    }
  }

  // Load nodes on component mount and when window becomes visible
  React.useEffect(() => {
    // Ensure auto-select is enabled by default when program opens
    // Only override if user has explicitly disabled it (saved as 'false' in localStorage)
    if (!localStorage.getItem('auto_select_node')) {
      // No saved preference, default to auto-select
      setAutoSelectNode(true)
    }
    
    // Load nodes on mount
    loadNodes()
    
    // Also reload when window becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadNodes()
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return (
    <>
      <button
        onClick={() => setShowNodeList(true)}
        className="w-full bg-white/95 dark:bg-gray-800/90 backdrop-blur-sm rounded-2xl shadow-xl p-4 hover:bg-white/85 dark:hover:bg-gray-800/80 hover:shadow-lg transition-all cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {autoSelectNode ? (
              <>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('selectedServer')}</p>
                  <p className="text-base font-semibold text-gray-800 dark:text-white">
                    {selectedNode ? `${selectedNode.name} (自动)` : '自动选择'}
                  </p>
                </div>
              </>
            ) : selectedNode ? (
              <>
                <span 
                  className="fi fis text-3xl rounded-full overflow-hidden border border-white dark:border-gray-700 shadow" 
                  style={{ 
                    backgroundImage: `url("https://flagcdn.com/w160/${selectedNode.country.toLowerCase()}.png")`, 
                    backgroundSize: 'cover', 
                    backgroundRepeat: 'no-repeat', 
                    backgroundPosition: 'center', 
                    display: 'inline-block', 
                    width: '40px', 
                    height: '40px' 
                  }}
                />
                <div className="text-left">
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('selectedServer')}</p>
                  <p className="text-base font-semibold text-gray-800 dark:text-white">{selectedNode.name}</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-base font-semibold text-gray-800 dark:text-white">{t('selectServer')}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('clickToSelect')}</p>
                </div>
              </>
            )}
          </div>
          <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>

      {/* Node selection modal */}
      {showNodeList && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-3" onClick={() => setShowNodeList(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800">
              <div className="flex items-center space-x-2.5">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">{t('selectServer')}</h3>
                <button 
                  onClick={loadNodes}
                  disabled={nodesLoading}
                  className={`text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-transform ${nodesLoading ? 'cursor-not-allowed opacity-50' : 'hover:rotate-180'}`}
                  title={t('refreshNodes')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              <button onClick={() => setShowNodeList(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(80vh-110px)]">
              {nodesLoading ? (
                <div className="p-10 text-center text-gray-500 dark:text-gray-400">
                  <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                  {t('loadingNodes')}
                </div>
              ) : !Array.isArray(nodes) || nodes.length === 0 ? (
                <div className="p-10 text-center text-gray-500 dark:text-gray-400 text-sm">{t('noAvailableNodes')}</div>
              ) : (
                <>
                  {/* Auto-select option */}
                  <button
                    onClick={() => {
                      handleSwitchNode('auto')
                      setShowNodeList(false)
                    }}
                    className={`w-full p-3.5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left border-b border-gray-100 dark:border-gray-700 ${
                      autoSelectNode ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-white text-sm">自动选择</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">自动选择延迟最低的节点</p>
                      </div>
                    </div>
                    {autoSelectNode && (
                      <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                    )}
                  </button>
                  
                  {/* Node list */}
                  {nodes.map((node, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      console.log('[Main UI] Selected node:', node)
                      handleSwitchNode(node)
                      setShowNodeList(false)
                    }}
                    className={`w-full p-3.5 flex items中心 justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left ${
                      selectedNode?.name === node.name ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    } ${index !== nodes.length - 1 ? 'border-b border-gray-100 dark:border-gray-700' : ''}`}
                  >
                    <div className="flex items-center space-x-3">
                      <span 
                        className="text-3xl rounded-full overflow-hidden border border-white dark:border-gray-700 shadow" 
                        style={{ 
                          backgroundImage: `url("https://flagcdn.com/w160/${node.country.toLowerCase()}.png")`, 
                          backgroundSize: 'cover', 
                          backgroundRepeat: 'no-repeat', 
                          backgroundPosition: 'center', 
                          display: 'inline-block', 
                          width: '40px', 
                          height: '40px' 
                        }}
                      />
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-white text-sm">{node.name}</p>
                      </div>
                    </div>
                    {node.status && (
                      <div className="flex items-center space-x-1.5">
                        {node.status === 'online' ? (
                          <>
                            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                            <span className="text-xs text-green-600 dark:text-green-400 font-semibold">{t('online')}</span>
                          </>
                        ) : node.status === 'offline' ? (
                          <>
                            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                            <span className="text-xs text-red-500 font-semibold">{t('offline')}</span>
                          </>
                        ) : (
                          <>
                            <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse"></div>
                            <span className="text-xs text-yellow-500 font-semibold">{t('checking')}</span>
                          </>
                        )}
                      </div>
                    )}
                  </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

