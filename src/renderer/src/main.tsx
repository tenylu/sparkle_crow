import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { HeroUIProvider } from '@heroui/react'
import '@renderer/assets/main.css'
import App from '@renderer/App'

// Load flag-icons from CDN
function loadFlagIcons() {
  const existingLink = document.querySelector('link[href*="flag-icons"]')
  if (existingLink) return // Already loaded
  
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.3.2/css/flag-icons.min.css'
  document.head.appendChild(link)
  console.log('[Main] Flag icons CSS loaded')
}

loadFlagIcons()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <HeroUIProvider>
      <App />
    </HeroUIProvider>
  </React.StrictMode>
)
