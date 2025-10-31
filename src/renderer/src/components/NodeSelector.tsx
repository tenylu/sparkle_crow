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
    setNodesLoading 
  } = useAppStore()

  const handleSwitchNode = async (newNode: typeof selectedNode) => {
    if (!newNode) return

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
      console.log('[Main] Loading real nodes from API...')
      const realNodes = await window.api.xboard.getNodes()
      console.log('[Main] Got nodes:', realNodes)
      
      // Check if realNodes is an array
      if (!Array.isArray(realNodes)) {
        console.error('[Main] Invalid nodes data:', realNodes)
        setNodes([])
        return
      }
      
      console.log('[Main] Got nodes count:', realNodes.length)
      
      // Map real nodes to our interface
      const mappedNodes = realNodes.map((node: any) => ({
        name: node.name || 'Unknown',
        type: node.type || 'unknown',
        server: node.server || '',
        port: node.port || 0,
        country: node.country || 'XX',
        flag: node.flag || '🌐',
        latency: node.latency,
        status: node.status || 'checking'
      }))
      
      console.log('[Main] Mapped nodes:', mappedNodes.length, mappedNodes)
      setNodes(mappedNodes)
      
      // Auto-select first node initially
      if (mappedNodes.length > 0) {
        console.log('[Main] Auto-selecting first node initially:', mappedNodes[0])
        setSelectedNode(mappedNodes[0])
      }
      
      // Verify nodes were set
      const verifyState = useAppStore.getState()
      console.log('[Main] Verify nodes after set:', verifyState.nodes.length, verifyState.nodes)

      // Async check latency and auto-select lowest latency node when all checks complete
      let completedCount = 0
      const totalNodes = mappedNodes.length
      
      mappedNodes.forEach((node, index) => {
        setTimeout(async () => {
          try {
            const { ipcRenderer } = window.electron
            const updatedNode = await ipcRenderer.invoke('check-node-latency', node)
            updateNode(node.name, updatedNode)
            
            completedCount++
            console.log(`[Main] Completed ${completedCount}/${totalNodes} latency checks`)
            
            // When all checks complete, select the node with lowest latency
            if (completedCount === totalNodes) {
              console.log('[Main] All latency checks complete, selecting lowest latency node...')
              const currentState = useAppStore.getState()
              const onlineNodes = currentState.nodes.filter(n => n.status === 'online' && n.latency !== undefined)
              
              if (onlineNodes.length > 0) {
                // Sort by latency and select the fastest
                const sortedNodes = [...onlineNodes].sort((a, b) => {
                  const latA = a.latency || 999999
                  const latB = b.latency || 999999
                  return latA - latB
                })
                
                const fastestNode = sortedNodes[0]
                console.log('[Main] Selecting fastest node:', fastestNode.name, 'latency:', fastestNode.latency)
                setSelectedNode(fastestNode)
              } else {
                console.log('[Main] No online nodes found, keeping current selection')
              }
            }
          } catch (error) {
            completedCount++
            updateNode(node.name, { status: 'offline' })
            console.log(`[Main] Completed ${completedCount}/${totalNodes} (node failed)`)
            
            // Still check if all nodes processed
            if (completedCount === totalNodes) {
              console.log('[Main] All latency checks complete (with failures)')
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
          }
        }, index * 50)
      })
    } catch (error) {
      console.error('[Main] Failed to load nodes:', error)
    } finally {
      setNodesLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setShowNodeList(true)}
        className="w-full bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-3xl shadow-2xl p-6 hover:bg-white/80 dark:hover:bg-gray-800/80 hover:shadow-xl transition-all cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {selectedNode ? (
              <>
                <span 
                  className="fi fis text-4xl rounded-full overflow-hidden border-2 border-white dark:border-gray-700 shadow-md" 
                  style={{ 
                    backgroundImage: `url("https://flagcdn.com/w160/${selectedNode.country.toLowerCase()}.png")`, 
                    backgroundSize: 'cover', 
                    backgroundRepeat: 'no-repeat', 
                    backgroundPosition: 'center', 
                    display: 'inline-block', 
                    width: '48px', 
                    height: '48px' 
                  }}
                />
                <div className="text-left">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('selectedServer')}</p>
                  <p className="text-lg font-bold text-gray-800 dark:text-white">{selectedNode.name}</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-lg font-bold text-gray-800 dark:text-white">{t('selectServer')}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('clickToSelect')}</p>
                </div>
              </>
            )}
          </div>
          <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>

      {/* Node selection modal */}
      {showNodeList && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowNodeList(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800">
              <div className="flex items-center space-x-3">
                <h3 className="text-xl font-bold text-gray-800 dark:text-white">{t('selectServer')}</h3>
                <button 
                  onClick={loadNodes}
                  disabled={nodesLoading}
                  className={`text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-transform ${nodesLoading ? 'cursor-not-allowed opacity-50' : 'hover:rotate-180'}`}
                  title={t('refreshNodes')}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              <button onClick={() => setShowNodeList(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(80vh-120px)]">
              {nodesLoading ? (
                <div className="p-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                  {t('loadingNodes')}
                </div>
              ) : !Array.isArray(nodes) || nodes.length === 0 ? (
                <div className="p-12 text-center text-gray-500 dark:text-gray-400">{t('noAvailableNodes')}</div>
              ) : (
                nodes.map((node, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      console.log('[Main UI] Selected node:', node)
                      handleSwitchNode(node)
                      setShowNodeList(false)
                    }}
                    className={`w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left ${
                      selectedNode?.name === node.name ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    } ${index !== nodes.length - 1 ? 'border-b border-gray-100 dark:border-gray-700' : ''}`}
                  >
                    <div className="flex items-center space-x-4">
                      <span 
                        className="text-4xl rounded-full overflow-hidden border-2 border-white dark:border-gray-700 shadow-md" 
                        style={{ 
                          backgroundImage: `url("https://flagcdn.com/w160/${node.country.toLowerCase()}.png")`, 
                          backgroundSize: 'cover', 
                          backgroundRepeat: 'no-repeat', 
                          backgroundPosition: 'center', 
                          display: 'inline-block', 
                          width: '48px', 
                          height: '48px' 
                        }}
                      />
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-white">{node.name}</p>
                      </div>
                    </div>
                    {node.status && (
                      <div className="flex items-center space-x-2">
                        {node.status === 'online' ? (
                          <>
                            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                            <span className="text-sm text-green-600 dark:text-green-400 font-semibold">{t('online')}</span>
                          </>
                        ) : node.status === 'offline' ? (
                          <>
                            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                            <span className="text-sm text-red-500 font-semibold">{t('offline')}</span>
                          </>
                        ) : (
                          <>
                            <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse"></div>
                            <span className="text-sm text-yellow-500 font-semibold">{t('checking')}</span>
                          </>
                        )}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

