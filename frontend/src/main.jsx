import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Build hash injected at build time - forces new bundle hashes on each deploy
// This fixes browser caching issues with environment variables
if (typeof __BUILD_HASH__ !== 'undefined') {
  console.log(`[Rose] Build: ${__BUILD_HASH__}`)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
