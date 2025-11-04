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
    <div className="fixed inset-0 flex items-center justify-center z-[9999] bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-96 max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">{t('confirmQuit')}</h3>
        </div>
        <div className="px-6 py-6">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 text-center">
            {t('confirmQuitMessage')}
          </p>
          <div className="flex justify-between space-x-3">
            {onMinimize && (
              <button
                onClick={onMinimize}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                {t('hide')}
              </button>
            )}
            <div className="flex space-x-3 ml-auto">
              <button
                onClick={onCancel}
                className="px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={onConfirm}
                className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
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
