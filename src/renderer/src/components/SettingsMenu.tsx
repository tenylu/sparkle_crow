import React, { useEffect, useState } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../hooks/useTranslation'

export const SettingsMenu: React.FC = () => {
  const { 
    showSettingsMenu, 
    setShowSettingsMenu,
    setShowSharedProxyModal,
    setShowUpdateModal,
    setUpdateInfo,
    hasUpdateAvailable,
    setHasUpdateAvailable,
    setLocalIP,
    setSelectedLanIP,
    setLanIPs,
    language,
    setLanguage,
    theme,
    setTheme
  } = useAppStore()
  const t = useTranslation()
  const [version, setVersion] = useState<string>('')

  // Get version on mount
  useEffect(() => {
    const getVersion = async () => {
      try {
        const v = await window.api.getVersion()
        setVersion(v)
      } catch (err) {
        console.error('Failed to get version:', err)
      }
    }
    getVersion()
  }, [])

  // Auto-check for updates on mount
  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const result = await window.api.update.checkUpdate()
        setHasUpdateAvailable(result !== undefined)
      } catch (err) {
        console.error('Failed to check update:', err)
      }
    }
    checkUpdate()
    // Check every 30 minutes
    const interval = setInterval(checkUpdate, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [setHasUpdateAvailable])

  const handleSharedProxy = async () => {
    setShowSettingsMenu(false)
    try {
      console.log('[Main] Refreshing LAN IPs...')
      const res = await window.api.net.getBestLanIP()
      console.log('[Main] Best IP:', res)
      if (res?.ip && res.ip !== '127.0.0.1') {
        setLocalIP(res.ip)
        setSelectedLanIP(res.ip)
      }
      
      const ipsRes = await window.api.net.listLanIPs()
      console.log('[Main] All LAN IPs:', ipsRes)
      if (ipsRes?.ips) {
        setLanIPs(ipsRes.ips)
      }
    } catch (error) {
      console.error('[Main] Failed to refresh IP:', error)
    }
    setShowSharedProxyModal(true)
  }

  const handleCheckUpdate = async () => {
    setShowSettingsMenu(false)
    try {
      const result = await window.api.update.checkUpdate()
      if (result) {
        setUpdateInfo(result)
        setShowUpdateModal(true)
      } else {
        alert('当前已是最新版本')
      }
    } catch (err: any) {
      alert('检查更新失败')
    }
  }

  return (
    <div className="relative">
      <button 
        onClick={() => setShowSettingsMenu(!showSettingsMenu)}
        className="w-10 h-10 rounded-full bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm shadow-lg flex items-center justify-center hover:bg-white dark:hover:bg-gray-800 transition-colors relative"
      >
        <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {hasUpdateAvailable && (
          <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-gray-800"></span>
        )}
      </button>
      
      {/* Settings Menu Dropdown */}
      {showSettingsMenu && (
        <div className="absolute top-14 right-0 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl py-2 min-w-56 z-50">
          <div className="py-1">
            <button
              onClick={handleSharedProxy}
              className="w-full px-4 py-3 flex items-center space-x-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
              </svg>
              <span className="text-sm text-gray-800 dark:text-gray-200">{t('sharedProxy')}</span>
            </button>
            <button
              onClick={handleCheckUpdate}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors relative"
            >
              <div className="flex items-center space-x-3">
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="text-sm text-gray-800 dark:text-gray-200 flex items-center">
                  {t('checkUpdate')}
                  {hasUpdateAvailable && (
                    <span className="ml-2 w-2 h-2 bg-red-500 rounded-full"></span>
                  )}
                </span>
              </div>
              {version && (
                <span className="text-xs text-gray-500 dark:text-gray-400">{version}</span>
              )}
            </button>
            
            {/* Language Switcher */}
            <button
              onClick={() => {
                setLanguage(language === 'zh' ? 'en' : 'zh')
                setShowSettingsMenu(false)
              }}
              className="w-full px-4 py-3 flex items-center space-x-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-t border-gray-200 dark:border-gray-700"
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
              </svg>
              <span className="text-sm text-gray-800 dark:text-gray-200">{language === 'zh' ? 'English' : '中文'}</span>
            </button>
            
            {/* Theme Switcher - 3 Icon Buttons */}
            <div className="border-t border-gray-200 dark:border-gray-700 px-2 py-2">
              <div className="flex items-center justify-between space-x-2">
                {/* Auto Theme Button */}
                <button
                  onClick={() => {
                    setTheme('auto')
                    setShowSettingsMenu(false)
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg transition-all ${
                    theme === 'auto' 
                      ? 'bg-blue-500 text-white shadow-md' 
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                  title={t('themeAuto')}
                >
                  <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
                
                {/* Light Theme Button */}
                <button
                  onClick={() => {
                    setTheme('light')
                    setShowSettingsMenu(false)
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg transition-all ${
                    theme === 'light' 
                      ? 'bg-blue-500 text-white shadow-md' 
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                  title={t('themeLight')}
                >
                  <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                </button>
                
                {/* Dark Theme Button */}
                <button
                  onClick={() => {
                    setTheme('dark')
                    setShowSettingsMenu(false)
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg transition-all ${
                    theme === 'dark' 
                      ? 'bg-blue-500 text-white shadow-md' 
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                  title={t('themeDark')}
                >
                  <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

