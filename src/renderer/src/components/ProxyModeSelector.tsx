import React, { useState, useEffect } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../hooks/useTranslation'

export const ProxyModeSelector: React.FC = () => {
  const { proxyMode, setProxyMode, isConnected, setIsConnecting } = useAppStore()
  const t = useTranslation()

  const handleModeChange = async (newMode: typeof proxyMode) => {
    if (!isConnected) {
      setProxyMode(newMode)
      return
    }

    setIsConnecting(true)
    try {
      console.log('Switching to mode:', newMode)
      await window.api.xboard.switchMode(newMode)
      setProxyMode(newMode)
    } catch (error: any) {
      console.error('Failed to switch mode:', error)
      alert(t('switchModeFailed'))
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">{t('proxyMode')}</p>
      <div className="flex rounded-lg bg-gray-100 dark:bg-gray-700 p-0.5">
        <button
          onClick={() => handleModeChange('rule')}
          className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
            proxyMode === 'rule'
              ? 'bg-blue-500 text-white shadow-sm hover:bg-blue-600 hover:opacity-90'
              : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-600 hover:opacity-80'
          }`}
        >
          {t('intelligent')}
        </button>
        <button
          onClick={() => handleModeChange('global')}
          className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
            proxyMode === 'global'
              ? 'bg-blue-500 text-white shadow-sm hover:bg-blue-600 hover:opacity-90'
              : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-600 hover:opacity-80'
          }`}
        >
          {t('global')}
        </button>
      </div>
    </div>
  )
}

