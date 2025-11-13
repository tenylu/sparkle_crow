import React, { useEffect, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../hooks/useTranslation'

interface Announcement {
  id: number
  title: string
  content: string
  created_at: number
}

const STORAGE_KEY = 'read_announcements'
const MAX_ANNOUNCEMENT_AGE = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds

export const AnnouncementModal: React.FC = () => {
  const { showAnnouncementModal, setShowAnnouncementModal, setHasUnreadAnnouncements } = useAppStore()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(false)
  const t = useTranslation()

  useEffect(() => {
    if (showAnnouncementModal) {
      loadAnnouncements()
      // Mark as read when modal is opened
      setHasUnreadAnnouncements(false)
    }
  }, [showAnnouncementModal])

  const loadAnnouncements = async () => {
    setLoading(true)
    try {
      console.log('[AnnouncementModal] Loading announcements...')
      const data = await window.api.xboard.getAnnouncements()
      console.log('[AnnouncementModal] Got announcements:', data)
      setAnnouncements(data || [])
      
      // Check for new announcements
      checkForNewAnnouncements(data || [])
      
      // Save read announcements to localStorage
      if (data && data.length > 0) {
        try {
          const readIds = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as number[]
          const newReadIds = Array.from(new Set([...readIds, ...data.map(a => a.id)]))
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newReadIds))
        } catch (error) {
          console.error('[AnnouncementModal] Error saving read announcements:', error)
        }
      }
    } catch (error) {
      console.error('[AnnouncementModal] Failed to load announcements:', error)
      setAnnouncements([])
    } finally {
      setLoading(false)
    }
  }

  const checkForNewAnnouncements = (announcements: Announcement[]) => {
    try {
      const readIds = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as number[]
      const now = Date.now()
      
      // Filter out old announcements and already read ones
      const newAnnouncements = announcements.filter(ann => {
        const age = now - (ann.created_at * 1000)
        return age <= MAX_ANNOUNCEMENT_AGE && !readIds.includes(ann.id)
      })
      
      setHasUnreadAnnouncements(newAnnouncements.length > 0)
      console.log('[AnnouncementModal] Found', newAnnouncements.length, 'new announcements')
    } catch (error) {
      console.error('[AnnouncementModal] Error checking new announcements:', error)
      // If we can't check, assume there are new announcements to be safe
      setHasUnreadAnnouncements(announcements.length > 0)
    }
  }

  if (!showAnnouncementModal) return null

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000)
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  return (
    <div className="fixed inset-0 z-[1050] flex items-center justify-center px-4 sm:px-6">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setShowAnnouncementModal(false)}
      ></div>
      
      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-lg max-h-[75vh] flex flex-col z-10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white">{t('announcements')}</h2>
          <button
            onClick={() => setShowAnnouncementModal(false)}
            className="w-7 h-7 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Content */}
        <div className="px-5 py-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-center py-10">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-[3px] border-blue-500 border-t-transparent"></div>
              <p className="text-gray-500 dark:text-gray-400 mt-3 text-sm">{t('loading')}</p>
            </div>
          ) : announcements.length === 0 ? (
            <div className="text-center py-10">
              <svg className="w-14 h-14 text-gray-300 dark:text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-gray-500 dark:text-gray-400 text-sm">{t('noAnnouncements')}</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {announcements.map((announcement) => (
                <div key={announcement.id} className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl p-4 border border-blue-100 dark:border-blue-800">
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-white">{announcement.title}</h3>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{formatDate(announcement.created_at)}</span>
                  </div>
                  {(() => {
                    const html = (announcement.content ?? '')
                    // sanitize and support newlines for plain text
                    const safe = DOMPurify.sanitize(html.includes('<') ? html : html.replace(/\n/g, '<br/>'))
                    return (
                      <div className="text-gray-700 dark:text-gray-300 leading-relaxed prose dark:prose-invert max-w-none text-xs" dangerouslySetInnerHTML={{ __html: safe }} />
                    )
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

