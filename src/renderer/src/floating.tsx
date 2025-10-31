import React from 'react'
import ReactDOM from 'react-dom/client'
import '@renderer/assets/floating.css'

const FloatingWindow: React.FC = () => {
  return (
    <div className="floating-window">
      <div className="floating-content">
        <div className="floating-status">
          <div className="status-indicator"></div>
        </div>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <FloatingWindow />
  </React.StrictMode>
)

