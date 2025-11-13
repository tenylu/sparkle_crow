import React, { useEffect } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../hooks/useTranslation'
import lightningIcon from '../assets/lightning.svg'

export const ConnectButton: React.FC = () => {
  const { isConnecting, isDisconnecting, isConnected, selectedNode, setIsConnecting, setIsDisconnecting, setIsConnected, proxyMode, userInfo } = useAppStore()
  const t = useTranslation()
  
  useEffect(() => {
    console.log('[ConnectButton] selectedNode changed:', selectedNode)
  }, [selectedNode])

  // Check if account is expired
  const isExpired = userInfo?.expired_at 
    ? Math.ceil((userInfo.expired_at * 1000 - Date.now()) / 1000 / 3600 / 24) <= 0
    : false

  // Check if traffic is exhausted
  const isTrafficExhausted = (() => {
    if (userInfo?.transfer_enable === undefined) return false
    
    const isUnlimited = userInfo.transfer_enable === 0 || userInfo.transfer_enable > 1000000000000000
    if (isUnlimited) return false

    const usedTraffic = userInfo?.total_used !== undefined 
      ? userInfo.total_used 
      : ((userInfo?.u || 0) + (userInfo?.d || 0))
    
    const remainingTraffic = userInfo.transfer_enable - usedTraffic
    return remainingTraffic <= 0
  })()

  const isDisabled = isExpired || isTrafficExhausted

  const getDisabledReason = () => {
    if (isExpired) return t('packageExpired')
    if (isTrafficExhausted) return t('trafficExhaustedAlert')
    return ''
  }

  const handleConnect = async () => {
    if (!selectedNode) return

    // Check disabled status
    if (isDisabled) {
      alert(getDisabledReason())
      return
    }

    if (isConnected) {
      // Disconnect
      setIsDisconnecting(true)
      try {
        await window.api.xboard.disconnect()
        setIsConnected(false)
      } catch (error: any) {
        console.error('Failed to disconnect:', error)
        alert(error.message || '断开连接失败')
      } finally {
        setIsDisconnecting(false)
      }
      return
    }

    // Connect
    setIsConnecting(true)
    try {
      console.log('Connecting to node:', selectedNode.name, 'mode:', proxyMode)
      await window.api.xboard.connect(selectedNode.name, proxyMode)
      setIsConnected(true)
    } catch (error: any) {
      console.error('Failed to connect:', error)
      alert(error.message || '连接失败')
    } finally {
      setIsConnecting(false)
    }
  }

  const isLoading = isConnecting || isDisconnecting

  return (
    <button
      onClick={handleConnect}
      disabled={isLoading || !selectedNode}
      className={`
        relative w-56 h-56 rounded-full transition-all duration-500 transform hover:scale-105
        ${selectedNode
          ? isConnected
            ? 'bg-gradient-to-br from-green-400 to-emerald-600 shadow-[0_0_50px_rgba(16,185,129,0.35)]'
            : isDisconnecting
            ? 'bg-gradient-to-br from-orange-400 to-red-500 shadow-[0_0_50px_rgba(249,115,22,0.35)]'
            : isConnecting
            ? 'bg-gradient-to-br from-yellow-400 to-orange-500 shadow-[0_0_50px_rgba(251,191,36,0.35)]'
            : isDisabled
            ? 'bg-gradient-to-br from-red-400 to-red-600 shadow-[0_0_50px_rgba(239,68,68,0.35)]'
            : 'bg-gradient-to-br from-blue-400 to-indigo-600 shadow-[0_0_50px_rgba(59,130,246,0.35)]'
          : 'bg-gray-400 cursor-not-allowed opacity-50'
        }
        ${isLoading ? 'animate-pulse' : ''}
        disabled:opacity-50 disabled:cursor-not-allowed
      `}
    >
      <div className="absolute inset-0 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
        {isLoading ? (
          <div className="relative w-full h-full flex items-center justify-center transition-all duration-300">
            {/* Rotating gradient circle - full size */}
            <div className="connect-loader-circle"></div>
            {/* Loading text */}
            <div className="connect-loader-letters">
              {(isDisconnecting ? t('disconnecting') : t('connecting')).split('').map((letter, i) => (
                <span key={i} className="connect-loader-letter">
                  {letter}
                </span>
              ))}
            </div>
          </div>
        ) : isConnected ? (
          <div className="relative z-10">
            <svg className="w-20 h-20 text-white animate-[breathing_3s_ease-in-out_infinite] origin-center" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        ) : (
          <div className="relative w-full h-full flex flex-col items-center justify-center space-y-3 transition-all duration-300">
            {/* Default pulse animation */}
            <div className="absolute inset-0 default-connection-pulse opacity-0 animate-[fadeIn_0.3s_ease-in-out_forwards]">
              <span></span>
            </div>
            {/* Lightning icon */}
            <div className="relative z-10 opacity-0 animate-[fadeIn_0.3s_ease-in-out_0.1s_forwards]">
              <img src={lightningIcon} alt="Lightning" className="w-18 h-18 brightness-0 invert" />
            </div>
            {/* Hint text */}
            <div className="relative z-10 opacity-0 animate-[fadeIn_0.3s_ease-in-out_0.15s_forwards] text-white text-sm font-semibold tracking-wide">
              {t('clickToConnectHint')}
            </div>
          </div>
        )}
      </div>
      {!selectedNode && (
        <div className="absolute bottom-10 left-0 right-0 text-center text-white text-base font-semibold">
          {t('selectNode')}
        </div>
      )}
      {selectedNode && isDisabled && (
        <div className="absolute bottom-10 left-0 right-0 text-center text-white text-base font-semibold">
          {isExpired ? t('expired') : isTrafficExhausted ? t('trafficExhausted') : ''}
        </div>
      )}
    </button>
  )
}

