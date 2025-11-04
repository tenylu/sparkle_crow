import React, { useState, useEffect } from 'react'
import Login from './pages/login'
import Main from './pages/main'
import { useAppStore } from './stores/useAppStore'

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loading, setLoading] = useState(true)
  const { theme, setTheme } = useAppStore()

  useEffect(() => {
    checkLoginStatus()
  }, [])

  // Initialize theme on app load
  useEffect(() => {
    // Listen for system theme changes in auto mode
    if (theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent) => {
        document.documentElement.classList.toggle('dark', e.matches)
      }
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme])

  const checkLoginStatus = async () => {
    try {
      const { loggedIn } = await window.api.xboard.checkLogin()
      setIsLoggedIn(loggedIn)
    } catch (error: any) {
      console.error('Failed to check login status:', error)
      // Even if check fails, show login page (not blank)
      setIsLoggedIn(false)
    } finally {
      setLoading(false)
    }
  }

  const handleLoginSuccess = () => {
    setIsLoggedIn(true)
  }

  const handleLogout = async () => {
    try {
      await window.api.xboard.logout()
      setIsLoggedIn(false)
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  if (loading) {
    return (
      <div className="w-full h-screen flex items-center justify-center">
        <div>Loading...</div>
      </div>
    )
  }

  if (!isLoggedIn) {
    return <Login onLoginSuccess={handleLoginSuccess} />
  }

  return <Main onLogout={handleLogout} />
}

export default App
