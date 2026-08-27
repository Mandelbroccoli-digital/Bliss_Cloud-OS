// Bliss OS — entry point for the hosted React control surface.
// The OS desktop shell runs from index.html; main.tsx mounts the React
// ControlBar (see App.tsx) into #root. This is the "hosted react engine"
// that auto-deploys to Vercel from this same git on every push.
import React from 'react'
import ReactDOM from 'react-dom/client'
import ControlBar from './App'

const root = document.getElementById('root')
if (root) {
  root.style.display = 'block'
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ControlBar />
    </React.StrictMode>
  )
}
