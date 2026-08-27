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

  return (
    <div style={{
      position: 'fixed', top: 6, right: 8, zIndex: 200000,
      display: 'flex', gap: 6, fontFamily: 'Segoe UI, Tahoma, sans-serif'
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
        background: 'rgba(0,0,0,0.35)', color: '#fff'
      }}>
        {mode === 'tauri' ? '🖥️ Local Iron' : '☁️ Cloud'}
      </span>
      <button onClick={toggleMode} title="Switch Local Iron ↔ Cloud"
        style={btn}>🔄 Mode</button>
      <button onClick={toggleTheme} title="Toggle Frutiger Aero"
        style={btn}>🌤️ Aero</button>
    </div>
  )
}

const btn = {
  fontSize: 10, padding: '3px 8px', cursor: 'pointer',
  border: '1px solid #5b86bd', borderRadius: 4, color: '#06203f',
  background: 'rgba(255,255,255,0.6)'
}

// Mount only if the shell reserved a visible root (set in index.html).
const root = document.getElementById('root')
if (root) {
  root.style.display = 'block'
  ReactDOM.createRoot(root).render(<ControlBar />)
}

export default ControlBar
