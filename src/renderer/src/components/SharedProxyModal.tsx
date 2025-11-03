import React, { useEffect, useState } from 'react'
import { useAppStore } from '../stores/useAppStore'

export const SharedProxyModal: React.FC = () => {
  const { 
    showSharedProxyModal, 
    setShowSharedProxyModal,
    localIP,
    selectedLanIP,
    setSelectedLanIP,
    lanIPs,
    isConnected 
  } = useAppStore()

  const [httpPort, setHttpPort] = useState('7890')
  const [socksPort, setSocksPort] = useState('7891')
  const [allowLan, setAllowLan] = useState(false)

  // Load port configuration when modal opens
  useEffect(() => {
    if (showSharedProxyModal) {
      const loadConfig = async () => {
        try {
          const config = await window.api.mihomo.getConfig()
          if (config) {
            const mixedPort = config['mixed-port'] || 7890
            const socks = config['socks-port'] || 7891
            const allowLanEnabled = config['allow-lan'] || false
            
            setHttpPort(mixedPort.toString())
            setSocksPort(socks.toString())
            setAllowLan(allowLanEnabled)
          }
        } catch (error) {
          console.error('[SharedProxy] Failed to load config:', error)
        }
      }
      loadConfig()
    }
  }, [showSharedProxyModal])

  if (!showSharedProxyModal) return null

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-96 max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">共享代理</h3>
        </div>
        <div className="px-6 py-6 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center">局域网设备可通过以下地址连接使用代理</p>
          
          {/* IP Selection */}
          {lanIPs.length > 0 && (
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">选择本机IP:</label>
              <select 
                value={selectedLanIP}
                onChange={(e) => setSelectedLanIP(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {lanIPs.map((ipInfo, index) => (
                  <option key={index} value={ipInfo.ip}>
                    {ipInfo.ip} ({ipInfo.interface}) - {ipInfo.family}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Links */}
          {selectedLanIP ? (
            <div className="space-y-3">
              {/* HTTP Proxy */}
              <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">HTTP代理:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`http://${selectedLanIP}:${httpPort}`)
                      alert('已复制到剪贴板')
                    }}
                    className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    复制
                  </button>
                </div>
                <code className="text-sm text-gray-700 dark:text-gray-300 break-all">
                  http://{selectedLanIP}:{httpPort}
                </code>
              </div>

              {/* SOCKS5 Proxy */}
              <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">SOCKS5代理:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`socks5://${selectedLanIP}:${socksPort}`)
                      alert('已复制到剪贴板')
                    }}
                    className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    复制
                  </button>
                </div>
                <code className="text-sm text-gray-700 dark:text-gray-300 break-all">
                  socks5://{selectedLanIP}:{socksPort}
                </code>
              </div>
              
              {!isConnected && (
                <p className="text-xs text-orange-500 dark:text-orange-400 text-center">提示：请先连接VPN以启用代理服务</p>
              )}
              
              {!allowLan && isConnected && (
                <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
                  <p className="text-xs text-red-600 dark:text-red-400 text-center font-semibold mb-1">⚠️ 局域网共享未开启</p>
                  <p className="text-xs text-red-500 dark:text-red-500/70 text-center">需要在设置中开启"允许局域网连接"才能使用共享代理</p>
                </div>
              )}
              
              {allowLan && isConnected && (
                <p className="text-xs text-green-600 dark:text-green-400 text-center">✅ 局域网共享已开启</p>
              )}
            </div>
          ) : (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4 text-center">
              <p className="text-sm text-yellow-600 dark:text-yellow-400">未检测到LAN IP地址</p>
              <p className="text-xs text-yellow-500 dark:text-yellow-500/70 mt-1">请确保设备已连接到局域网</p>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            onClick={() => setShowSharedProxyModal(false)}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

