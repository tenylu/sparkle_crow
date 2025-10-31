import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../hooks/useTranslation'
import notImg from '../assets/not.png'

export const StatusCard: React.FC = () => {
  const { userInfo, isConnected, setUserInfo } = useAppStore()
  const t = useTranslation()
  const [showNoPlanModal, setShowNoPlanModal] = useState(false)
  const [checking, setChecking] = useState(false)

  const remainingDays = userInfo?.expired_at 
    ? Math.ceil((userInfo.expired_at * 1000 - Date.now()) / 1000 / 3600 / 24)
    : null

  // Calculate remaining traffic - try total_used first, then fallback to u+d
  const usedTraffic = userInfo?.total_used !== undefined 
    ? userInfo.total_used 
    : ((userInfo?.u || 0) + (userInfo?.d || 0))
  
  const remainingTraffic = userInfo?.transfer_enable !== undefined
    ? Math.floor(((userInfo.transfer_enable - usedTraffic) / 1024 / 1024 / 1024) * 100) / 100
    : null

  const totalTraffic = userInfo?.transfer_enable
    ? Math.floor((userInfo.transfer_enable / 1024 / 1024 / 1024) * 100) / 100
    : null

  // Check if traffic is unlimited (transfer_enable is 0 or very large)
  const isUnlimited = userInfo?.transfer_enable !== undefined && 
    (userInfo.transfer_enable === 0 || userInfo.transfer_enable > 1000000000000000) // > 1 PB

  const isTrafficExhausted = !isUnlimited && remainingTraffic !== null && remainingTraffic <= 0

  const isExpired = remainingDays !== null && remainingDays <= 0
  const isPermanent = userInfo?.expired_at === null || userInfo?.expired_at === undefined || userInfo?.expired_at === 0

  // Check if no plan is purchased, expired, or traffic exhausted
  // Only check if userInfo is loaded (not null)
  const hasNoPlan = userInfo !== null && (!userInfo?.plan_id || userInfo.plan_id === 0)
  const shouldShowModal = userInfo !== null && (hasNoPlan || isExpired || isTrafficExhausted)
  
  // Determine modal type and content
  const getModalContent = () => {
    if (isTrafficExhausted) {
      return {
        title: t('trafficExhaustedTitle'),
        description: t('trafficExhaustedGuide'),
        primaryButton: t('resetTraffic'),
        secondaryButton: t('alreadyReset')
      }
    } else if (isExpired) {
      return {
        title: t('expiredTitle'),
        description: t('expiredGuide'),
        primaryButton: t('renewPlan'),
        secondaryButton: t('alreadyRenewed')
      }
    } else {
      return {
        title: t('noPlanTitle'),
        description: t('noPlanGuide'),
        primaryButton: t('buyPlan'),
        secondaryButton: t('alreadyPurchased')
      }
    }
  }
  
  useEffect(() => {
    if (shouldShowModal) {
      setShowNoPlanModal(true)
    }
  }, [shouldShowModal])

  const handleCheckPurchased = async () => {
    setChecking(true)
    try {
      const info = await window.api.xboard.getUserInfo()
      setUserInfo(info)
      // Check again if plan was purchased, not expired, and traffic is not exhausted
      const newRemainingDays = info?.expired_at 
        ? Math.ceil((info.expired_at * 1000 - Date.now()) / 1000 / 3600 / 24)
        : null
      const newIsExpired = newRemainingDays !== null && newRemainingDays <= 0
      const newUsedTraffic = info?.total_used !== undefined 
        ? info.total_used 
        : ((info?.u || 0) + (info?.d || 0))
      const newRemainingTraffic = info?.transfer_enable !== undefined
        ? Math.floor(((info.transfer_enable - newUsedTraffic) / 1024 / 1024 / 1024) * 100) / 100
        : null
      const newIsUnlimited = info?.transfer_enable !== undefined && 
        (info.transfer_enable === 0 || info.transfer_enable > 1000000000000000)
      const newIsTrafficExhausted = !newIsUnlimited && newRemainingTraffic !== null && newRemainingTraffic <= 0
      
      if (info?.plan_id && info.plan_id !== 0 && !newIsExpired && !newIsTrafficExhausted) {
        setShowNoPlanModal(false)
      }
    } catch (error) {
      console.error('Failed to check user info:', error)
    } finally {
      setChecking(false)
    }
  }

  const modalContent = getModalContent()

  return (
    <>
      {/* Connection status text */}
      <div className="text-center">
        <p className="text-3xl font-bold text-gray-800 dark:text-white mb-2">
          {isConnected ? t('connected') : t('disconnected')}
        </p>
        <p className="text-base text-gray-500 dark:text-gray-400">
          {userInfo?.plan_name || t('planInfoNotAvailable')}
        </p>
      </div>

      {/* Traffic and Plan info card */}
      <div className="bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-3xl shadow-xl p-6">
        <div className="flex items-center justify-center space-x-8">
          {/* Plan validity info */}
          <div className="text-center">
            <div className={`text-3xl font-bold mb-2 ${isExpired ? 'text-red-500' : 'text-gray-800 dark:text-white'}`}>
              {isExpired ? t('expired') : isPermanent ? t('permanent') : remainingDays !== null ? `${remainingDays}` : '-'}
              {!isExpired && !isPermanent && remainingDays !== null && <span className="text-base">{t('days')}</span>}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{t('planValidity')}</div>
          </div>
          {/* Divider */}
          <div className="h-14 w-px bg-gray-300 dark:bg-gray-600"></div>
          {/* Traffic info */}
          <div className="text-center">
            <div className={`text-3xl font-bold mb-2 ${isTrafficExhausted ? 'text-red-500' : 'text-gray-800 dark:text-white'}`}>
              {isTrafficExhausted ? t('trafficExhausted') : isUnlimited ? t('unlimited') : remainingTraffic !== null ? `${remainingTraffic}` : '-'}
              {!isTrafficExhausted && !isUnlimited && remainingTraffic !== null && <span className="text-base">{t('gb')}</span>}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">
              {t('remainingTraffic')} / {t('totalTraffic')} {isUnlimited ? '∞' : totalTraffic !== null ? `${totalTraffic}` : '-'}{!isUnlimited && t('gb')}
            </div>
          </div>
        </div>
      </div>

      {/* No Plan Modal - Full screen blocking modal - rendered via portal to document.body */}
      {showNoPlanModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          {/* Full screen backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
          
          {/* Modal */}
          <div className="relative bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-md z-10 mx-4 overflow-hidden">
            {/* Image Section - Top 45% */}
            <div className="relative w-full bg-gradient-to-br from-pink-100 via-orange-100 to-blue-100 dark:from-pink-900/30 dark:via-orange-900/30 dark:to-blue-900/30" style={{ height: '45%' }}>
              <img src={notImg} alt="No plan" className="w-full h-full object-cover" />
            </div>
            
            {/* Text and Button Section - Bottom 55% */}
            <div className="bg-white dark:bg-gray-800 p-8" style={{ height: '55%', display: 'flex', flexDirection: 'column' }}>
              <div className="flex-1">
                {/* Title */}
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
                  {modalContent.title}
                </h2>
                
                {/* Description */}
                <p className="text-base text-gray-600 dark:text-gray-400 leading-relaxed">
                  {modalContent.description}
                </p>
              </div>
              
              {/* Buttons */}
              <div className="flex flex-col space-y-3 mt-6">
                <button
                  onClick={() => {
                    window.open('https://user.crowmesh.com/subscription', '_blank')
                  }}
                  className="w-full px-6 py-4 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-semibold rounded-xl transition-colors hover:bg-gray-800 dark:hover:bg-gray-100"
                >
                  {modalContent.primaryButton}
                </button>
                <button
                  onClick={handleCheckPurchased}
                  disabled={checking}
                  className={`w-full px-6 py-4 font-semibold rounded-xl transition-colors ${
                    checking 
                      ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed' 
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {checking ? t('checkPurchaseInProgress') : modalContent.secondaryButton}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

