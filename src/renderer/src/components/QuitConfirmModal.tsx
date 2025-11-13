import React from 'react'
import { useTranslation } from '../hooks/useTranslation'

interface QuitConfirmModalProps {
  onConfirm: () => void
  onCancel: () => void
  onMinimize?: () => void
}

export const QuitConfirmModal: React.FC<QuitConfirmModalProps> = ({ onConfirm, onCancel, onMinimize }) => {
  const t = useTranslation()
  
  return (
    <div className="fixed inset-0 flex items-center justify-center z-[9999] bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-sm">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white">{t('confirmQuit')}</h3>
        </div>
        <div className="px-5 py-5">
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-5 text-center leading-relaxed">
            {t('confirmQuitMessage')}
          </p>
          <div className="flex justify-between space-x-2 text-xs">
            {onMinimize && (
              <button
                onClick={onMinimize}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                {t('hide')}
              </button>
            )}
            <div className="flex space-x-2 ml-auto">
              <button
                onClick={onCancel}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={onConfirm}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                {t('quit')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
