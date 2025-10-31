import React, { useState, useEffect } from 'react'
import { useTranslation } from '../hooks/useTranslation'

export const TunToggle: React.FC = () => {
  const t = useTranslation()
  const [loading, setLoading] = useState(true)
  const [enable, setEnable] = useState(false)

  useEffect(() => {
    let mounted = true
    window.api.xboard.getTun().then((res) => {
      if (!mounted) return
      setEnable(Boolean(res?.enable))
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => { mounted = false }
  }, [])

  const onToggle = async (): Promise<void> => {
    setLoading(true)
    try {
      const next = !enable
      const res = await window.api.xboard.setTun(next)
      if (res?.success) {
        setEnable(next)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('tunTitle')}</p>
      <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-1 relative">
        <button
          onClick={onToggle}
          disabled={loading}
          className={`w-full flex items-center justify-between p-2 rounded-md transition-all ${
            enable ? 'text-emerald-700 dark:text-emerald-400 bg-white dark:bg-gray-800 shadow-sm hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:opacity-90' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 hover:opacity-80'
          } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <div className="flex items-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span className="text-sm font-semibold">
              {enable ? t('tunEnabled') : t('tunDisabled')}
            </span>
          </div>
        </button>
      </div>
    </div>
  )
}

