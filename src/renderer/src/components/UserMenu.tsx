import React from 'react'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../hooks/useTranslation'

interface UserMenuProps {
  onLogout: () => void
}

export const UserMenu: React.FC<UserMenuProps> = ({ onLogout }) => {
  const { showUserMenu, setShowUserMenu, userInfo } = useAppStore()
  const t = useTranslation()

  const openSupportChat = async () => {
    try {
      await window.api.ui.openSupport()
    } catch {}
  }

  return (
    <>
      <button 
        onClick={() => setShowUserMenu(!showUserMenu)}
        className="w-10 h-10 rounded-full bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm shadow-lg flex items-center justify-center hover:bg-white dark:hover:bg-gray-800 transition-colors"
      >
        <svg 
          className="w-6 h-6 text-gray-700 dark:text-gray-200"
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </button>
      
      {/* User Menu Dropdown */}
      {showUserMenu && (
        <div className="absolute top-14 left-0 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl py-2 min-w-56 z-50">
          {/* Account Info */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('account')}</p>
            <p className="text-sm font-semibold text-gray-800 dark:text-white">{userInfo?.email || '-'}</p>
          </div>
          
          {/* Menu Items */}
          <div className="py-1">
            <button
              onClick={() => {
                setShowUserMenu(false)
                openSupportChat()
              }}
              className="w-full px-4 py-3 flex items-center space-x-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h6m8 0a9 9 0 11-18 0 9 9 0 0118 0zm-5 5l4 2-1-3" />
              </svg>
              <span className="text-sm text-gray-800 dark:text-gray-200">{t('support')}</span>
            </button>
            <button
              onClick={() => {
                setShowUserMenu(false)
                window.open('https://user.crowmesh.com/subscription', '_blank')
              }}
              className="w-full px-4 py-3 flex items-center space-x-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-gray-800 dark:text-gray-200">{t('buyPlan')}</span>
            </button>
            <button
              onClick={() => {
                setShowUserMenu(false)
                onLogout()
              }}
              className="w-full px-4 py-3 flex items-center space-x-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="text-sm text-gray-800 dark:text-gray-200">{t('logout')}</span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}

