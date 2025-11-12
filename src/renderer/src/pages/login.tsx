import React, { useState, useEffect } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../hooks/useTranslation'
import { QuitConfirmModal } from '../components/QuitConfirmModal'
import logoImg from '../assets/logo.png'

interface LoginProps {
  onLoginSuccess?: () => void
}

type ViewMode = 'login' | 'register' | 'forgotPassword'

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const baseURL = 'https://xb.crowmesh.com'
  const [viewMode, setViewMode] = useState<ViewMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetCode, setResetCode] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [sendingVerifyCode, setSendingVerifyCode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ version: string; changelog: string } | null>(null)
  const [downloadingUpdate, setDownloadingUpdate] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<{ downloading: boolean; progress: number } | null>(null)
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState(false)
  const [showQuitConfirm, setShowQuitConfirm] = useState(false)
  const [version, setVersion] = useState<string>('')
  const { language, setLanguage, theme, setTheme } = useAppStore()
  const t = useTranslation()

  useEffect(() => {
    // Check if already logged in
    window.api.xboard.checkLogin().then(({ loggedIn, config }) => {
      if (loggedIn && config?.email) {
        setEmail(config.email)
      }
    })
  }, [])

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
  }, [])

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
    // Auto-close success/error messages after 3 seconds
    if (success) {
      const timer = setTimeout(() => {
        setSuccess('')
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [success])

  useEffect(() => {
    // Auto-close success/error messages after 3 seconds
    if (error) {
      const timer = setTimeout(() => {
        setError('')
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [error])

  // Listen for quit confirmation request
  useEffect(() => {
    const unsubscribe = window.api.onQuitConfirm(() => {
      setShowQuitConfirm(true)
    })
    return unsubscribe
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      const result = await window.api.xboard.login(baseURL, email, password)
      if (result.success) {
        onLoginSuccess?.()
      } else if (result.error) {
        // Handle error returned from IPC handler (not thrown)
        setError(result.error)
      }
    } catch (err: any) {
      // Display detailed error message from backend
      let errorMessage = err?.message || t('loginFailed')
      
      // Remove any English error prefixes that might be in the message
      errorMessage = errorMessage.replace(/^Error occurred in handler for.*?Error:\s*/i, '')
        .replace(/^Error:\s*/i, '')
        .replace(/at\s+.*/g, '') // Remove stack trace lines
        .trim()
      
      // If message is empty after cleaning, use default
      if (!errorMessage) {
        errorMessage = t('loginFailed')
      }
      
      setError(errorMessage)
      console.error('[Login] Login error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSendVerifyCode = async () => {
    if (!email) {
      setError(t('emailRequired'))
      return
    }

    setSendingVerifyCode(true)
    setError('')
    try {
      await window.api.xboard.sendRegisterCode(baseURL, email)
      setSuccess(t('codeSent'))
    } catch (err: any) {
      setError(t('sendCodeFailed'))
    } finally {
      setSendingVerifyCode(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    
    if (!inviteCode) {
      setError(t('inviteCodeRequired'))
      return
    }

    if (!verifyCode) {
      setError(t('verifyCodeRequired'))
      return
    }

    if (password !== confirmPassword) {
      setError(t('passwordMismatch'))
      return
    }

    setLoading(true)
    try {
      await window.api.xboard.register(baseURL, email, password, inviteCode, verifyCode)
      setSuccess(t('registerSuccess'))
      setTimeout(() => {
        setViewMode('login')
        setSuccess('')
        setInviteCode('')
        setVerifyCode('')
      }, 2000)
    } catch (err: any) {
      setError(t('registerFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      await window.api.xboard.sendResetCode(baseURL, email)
      setSuccess(t('codeSent'))
      // 显示验证码输入框
      setResetCode('') // 设置为空字符串以触发显示验证码输入表单
    } catch (err: any) {
      setError(t('resetFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      await window.api.xboard.resetPassword(baseURL, email, resetCode as string, newPassword)
      setSuccess(t('resetSuccess'))
      setTimeout(() => {
        setViewMode('login')
        setSuccess('')
      }, 2000)
    } catch (err: any) {
      setError(t('resetFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleCheckUpdate = async () => {
    setShowSettingsMenu(false)
    setCheckingUpdate(true)
    setError('')
    setSuccess('')
    
    try {
      const result = await window.api.update.checkUpdate()
      if (result) {
        setUpdateInfo(result)
        setShowUpdateModal(true)
      } else {
        setSuccess('当前已是最新版本')
      }
    } catch (err: any) {
      setError('检查更新失败')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleUpdateConfirm = async () => {
    if (!updateInfo) return
    setDownloadingUpdate(true)
    try {
      await window.api.update.downloadAndInstallUpdate(updateInfo.version)
      // 下载完成后会自动安装并重启
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '未知错误'
      setError('更新失败：' + errorMessage)
      setDownloadingUpdate(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 via-indigo-50 to-white dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 relative">
      {/* Draggable area at the top */}
      <div className="fixed top-0 left-0 right-0 h-12 z-30" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}></div>
      
      {/* Settings button in top-right corner */}
      <div className="fixed top-6 right-6 z-50" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
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
            <>
              {/* Click outside to close */}
              <div 
                className="fixed inset-0 z-40"
                onClick={() => setShowSettingsMenu(false)}
              ></div>
              <div className="absolute top-14 right-0 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl py-2 min-w-56 z-50">
                <div className="py-1">
                  <button
                    onClick={handleCheckUpdate}
                    disabled={checkingUpdate}
                    className={`w-full px-4 py-3 flex items-center justify-between transition-colors relative ${
                      checkingUpdate 
                        ? 'cursor-not-allowed bg-gray-100 dark:bg-gray-700' 
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span className="text-sm text-gray-800 dark:text-gray-200 flex items-center">
                        {checkingUpdate ? '检查中...' : t('checkUpdate')}
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
            </>
          )}
        </div>
      </div>

      {/* Success toast at the top */}
      {success && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-xl px-4">
          <div className="bg-green-500 text-white px-6 py-3 rounded-xl shadow-lg flex items-center space-x-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium flex-1 text-center">{success}</span>
            <button
              onClick={() => setSuccess('')}
              className="hover:text-gray-200 flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Error toast at the top */}
      {error && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-xl px-4">
          <div className="bg-red-500 text-white px-6 py-3 rounded-xl shadow-lg flex items-start space-x-3">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium flex-1 text-left whitespace-pre-line break-words">{error}</span>
            <button
              onClick={() => setError('')}
              className="hover:text-gray-200 flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8">
        <div className="text-center mb-6">
          {/* Logo - Only show on login page */}
          {viewMode === 'login' && (
            <div className="flex justify-center mb-4">
              <img src={logoImg} alt="CrowVPN" className="w-20 h-20" />
            </div>
          )}
          
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
            {viewMode === 'login' ? t('loginTitle') : viewMode === 'register' ? t('registerTitle') : t('forgotPasswordTitle')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {viewMode === 'login' ? t('loginSubtitle') : viewMode === 'register' ? t('registerSubtitle') : t('forgotPasswordSubtitle')}
          </p>
        </div>
        
        {/* Login Form */}
        {viewMode === 'login' && (
          <form onSubmit={handleLogin} className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-0">
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{t('emailLabel')}</label>
              <div className="border border-gray-200 dark:border-gray-600 rounded-lg h-12 flex items-center px-3 transition-colors focus-within:border-blue-500 bg-white dark:bg-gray-700">
                <input
                  type="email"
                  placeholder={t('emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-lg border-none w-full h-full focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  required
                />
              </div>
            </div>
            
            <div className="flex flex-col gap-0">
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{t('passwordLabel')}</label>
              <div className="border border-gray-200 dark:border-gray-600 rounded-lg h-12 flex items-center px-3 transition-colors focus-within:border-blue-500 bg-white dark:bg-gray-700">
                <input
                  type="password"
                  placeholder={t('passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-lg border-none w-full h-full focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  required
                />
              </div>
            </div>

            <div className="flex flex-row items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="rememberMe" className="w-4 h-4" />
                <label htmlFor="rememberMe" className="text-sm text-gray-900 dark:text-gray-100">{t('rememberMe')}</label>
              </div>
              <button
                type="button"
                onClick={() => {
                  setViewMode('forgotPassword')
                  setError('')
                  setSuccess('')
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
              >
                {t('forgotPassword')}
              </button>
            </div>
          
            <button
              type="submit"
              disabled={loading}
              className={`mt-5 mb-2.5 bg-blue-500 border-none text-white text-sm font-medium rounded-lg h-12 w-full cursor-pointer transition-opacity ${
                loading ? 'bg-blue-300 cursor-not-allowed' : 'hover:bg-blue-600'
              }`}
            >
              {loading ? t('loggingIn') : t('loginButton')}
            </button>

            <p className="text-center text-gray-900 dark:text-gray-100 text-sm my-1">
              {t('dontHaveAccount')} <button
                type="button"
                onClick={() => {
                  setViewMode('register')
                  setError('')
                  setSuccess('')
                }}
                className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
              >
                {t('signUp')}
              </button>
            </p>
          </form>
        )}

        {/* Register Form */}
        {viewMode === 'register' && (
          <form onSubmit={handleRegister} className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-0">
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{t('inviteCode')}</label>
              <div className="border border-gray-200 dark:border-gray-600 rounded-lg h-12 flex items-center px-3 transition-colors focus-within:border-blue-500 bg-white dark:bg-gray-700">
                  <input
                    type="text"
                    placeholder={t('inviteCodePlaceholder')}
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                  className="rounded-lg border-none w-full h-full focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-0">
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{t('emailLabel')}</label>
              <div className="border border-gray-200 dark:border-gray-600 rounded-lg h-12 flex items-center px-3 transition-colors focus-within:border-blue-500 bg-white dark:bg-gray-700">
                <input
                  type="email"
                  placeholder={t('emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-lg border-none w-full h-full focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-0">
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{t('verifyCode')}</label>
              <div className="flex gap-2">
                <div className="border border-gray-200 dark:border-gray-600 rounded-lg h-12 flex items-center px-3 transition-colors focus-within:border-blue-500 bg-white dark:bg-gray-700 flex-1">
                  <input
                    type="text"
                    placeholder={t('verifyCodePlaceholder')}
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                    className="rounded-lg border-none w-full h-full focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    required
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSendVerifyCode}
                  disabled={sendingVerifyCode || !email}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-opacity whitespace-nowrap ${
                    sendingVerifyCode || !email
                      ? 'bg-blue-300 text-white cursor-not-allowed'
                      : 'bg-blue-500 text-white hover:bg-blue-600'
                  }`}
                >
                  {sendingVerifyCode ? t('sending') : t('sendVerifyCode')}
                </button>
              </div>
            </div>
            
            <div className="flex flex-col gap-0">
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{t('passwordLabel')}</label>
              <div className="border border-gray-200 dark:border-gray-600 rounded-lg h-12 flex items-center px-3 transition-colors focus-within:border-blue-500 bg-white dark:bg-gray-700">
                <input
                  type="password"
                  placeholder={t('passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-lg border-none w-full h-full focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-0">
              <label className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{t('confirmPassword')}</label>
              <div className="border border-gray-200 dark:border-gray-600 rounded-lg h-12 flex items-center px-3 transition-colors focus-within:border-blue-500 bg-white dark:bg-gray-700">
                <input
                  type="password"
                  placeholder={t('confirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="rounded-lg border-none w-full h-full focus:outline-none bg-transparent text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  required
                />
              </div>
            </div>
          
            <button
              type="submit"
              disabled={loading}
              className={`mt-5 mb-2.5 bg-blue-500 border-none text-white text-sm font-medium rounded-lg h-12 w-full cursor-pointer transition-opacity ${
                loading ? 'bg-blue-300 cursor-not-allowed' : 'hover:bg-blue-600'
              }`}
            >
              {loading ? t('registering') : t('registerButton')}
            </button>
          </form>
        )}

        {/* Forgot Password Form */}
        {viewMode === 'forgotPassword' && (
          <form onSubmit={resetCode !== null ? handleResetPassword : handleForgotPassword} className="space-y-6">
          <div>
            <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                <span>{t('emailLabel')}</span>
            </div>
            <input
              type="email"
                placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 focus:border-blue-500 focus:outline-none transition-colors bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                required
                disabled={resetCode !== null}
              />
            </div>

            {resetCode === null ? (
              <button
                type="submit"
                disabled={loading}
                className={`w-full py-3 rounded-xl font-semibold text-white transition-all ${
                  loading 
                    ? 'bg-blue-300 cursor-not-allowed' 
                    : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {loading ? t('sending') : t('sendResetCode')}
              </button>
            ) : (
              <>
                <div>
                  <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <span>{t('resetCode')}</span>
                  </div>
                  <input
                    type="text"
                    placeholder={t('resetCodePlaceholder')}
                    value={resetCode || ''}
                    onChange={(e) => setResetCode(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 focus:border-blue-500 focus:outline-none transition-colors bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              required
            />
          </div>
          
          <div>
            <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <span>{t('newPassword')}</span>
            </div>
            <input
              type="password"
                    placeholder={t('newPasswordPlaceholder')}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 focus:border-blue-500 focus:outline-none transition-colors bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              required
            />
          </div>
          
          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 rounded-xl font-semibold text-white transition-all ${
              loading 
                ? 'bg-blue-300 cursor-not-allowed' 
                      : 'bg-blue-500 hover:bg-blue-600'
            }`}
          >
                  {loading ? t('resetting') : t('resetPassword')}
          </button>
              </>
            )}
        </form>
        )}

        {/* Back to Login for Register/Forgot Password */}
        {(viewMode === 'register' || viewMode === 'forgotPassword') && (
          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setViewMode('login')
                setError('')
                setSuccess('')
                setResetCode(null)
                setNewPassword('')
                setConfirmPassword('')
                setInviteCode('')
                setVerifyCode('')
              }}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              {t('backToLogin')}
            </button>
          </div>
        )}
      </div>
      
      {/* Copyright */}
      <div className="fixed bottom-8 left-0 right-0 text-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          我们在意您的隐私安全。版权所有© 2012-2025 crowmesh.com
        </p>
      </div>

      {/* Update Modal */}
      {showUpdateModal && updateInfo && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]"
            onClick={() => !downloadingUpdate && setShowUpdateModal(false)}
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
                    disabled={downloadingUpdate || updateProgress?.downloading}
                    className="flex-1 py-3 rounded-xl font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleUpdateConfirm}
                    disabled={downloadingUpdate || updateProgress?.downloading}
                    className="flex-1 py-3 rounded-xl font-semibold text-white bg-blue-500 hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {updateProgress?.downloading ? (updateProgress.progress === 0 ? '安装中...' : '下载中...') : (downloadingUpdate ? '更新中...' : '立即更新')}
                    </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Quit Confirmation Modal */}
      {showQuitConfirm && (
        <QuitConfirmModal
          onConfirm={() => {
            window.api.sendQuitConfirmResult('quit')
            setShowQuitConfirm(false)
          }}
          onCancel={() => {
            window.api.sendQuitConfirmResult('cancel')
            setShowQuitConfirm(false)
          }}
          onMinimize={() => {
            window.api.sendQuitConfirmResult('minimize')
            setShowQuitConfirm(false)
          }}
        />
      )}
    </div>
  )
}

export default Login