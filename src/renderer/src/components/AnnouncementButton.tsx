import React from 'react'
import { useAppStore } from '../stores/useAppStore'

export const AnnouncementButton: React.FC = () => {
  const { setShowAnnouncementModal, hasUnreadAnnouncements } = useAppStore()

  return (
    <button 
      onClick={() => setShowAnnouncementModal(true)}
      className="w-10 h-10 rounded-full bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm shadow-lg flex items-center justify-center hover:bg-white dark:hover:bg-gray-800 transition-colors relative"
    >
      <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      {/* Badge for unread announcements */}
      {hasUnreadAnnouncements && (
        <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-white dark:border-gray-800"></span>
      )}
    </button>
  )
}

