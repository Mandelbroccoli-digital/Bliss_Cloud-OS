// Bliss OS — hosted React control surface.
// The desktop shell itself lives in index.html (HTML/JS, mirrors the Tauri
// champion). This React engine mounts a thin control bar that drives the shell's
// setTheme/setMode contract — proof the "hosted react engine" is live, and the
// seam where future React-mounted panels (settings, garden monitor) will hang.
import { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'

// Shell contract (declared in index.html inline script).
declare global {
  interface Window {
    setTheme?: (theme: string) => void
    setMode?: (mode: string) => void
  }
}

function ControlBar() {
  const [theme, setThemeState] = useState(
    () => localStorage.getItem('bliss26_theme') || 'rubedo'
  )
  const [mode, setModeState] = useState(
    () => localStorage.getItem('bliss26_mode') || 'cloud'
  )

  useEffect(() => {
    // Keep the React view in sync if the shell toggles via tray buttons.
    const onStorage = () => {
      setThemeState(localStorage.getItem('bliss26_theme') || 'rubedo')
      setModeState(localStorage.getItem('bliss26_mode') || 'cloud')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'aero' ? 'rubedo' : 'aero'
    if (window.setTheme) window.setTheme(next)
    setThemeState(next)
  }
  const toggleMode = () => {
    const next = mode === 'tauri' ? 'cloud' : 'tauri'
    if (window.setMode) window.setMode(next)
    setModeState(next)
  }

  // The top-right control bar has been intentionally disabled.
  // Theme/mode toggles are available only via the taskbar tray buttons.
  return null
}

const btn = {
  fontSize: 10, padding: '3px 8px', cursor: 'pointer',
  border: '1px solid #5b86bd', borderRadius: 4, color: '#06203f',
  background: 'rgba(255,255,255,0.6)'
}

// NOTE: We intentionally do NOT mount this React control surface by default
// (the host shell already exposes equivalent controls in the taskbar). This
// avoids duplicate UI (top-right buttons) that can obstruct the toolbar.

export default ControlBar
