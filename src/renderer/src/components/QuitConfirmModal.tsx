import React from 'react'

interface QuitConfirmModalProps {
  onConfirm: () => void
  onCancel: () => void
}

export const QuitConfirmModal: React.FC<QuitConfirmModalProps> = ({ onConfirm, onCancel }) => {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-[9999] bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-96 max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">确认退出</h3>
        </div>
        <div className="px-6 py-6">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 text-center">
            确定要退出 CrowVPN 吗？
          </p>
          <div className="flex justify-end space-x-3">
            <button
              onClick={onCancel}
              className="px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              退出
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
