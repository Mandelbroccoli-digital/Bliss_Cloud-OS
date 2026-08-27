# Bliss OS — Cloud Operating System

A browser-based desktop environment that recreates the classic Windows XP aesthetic with a modern, cloud-native twist. Bliss OS runs entirely in the browser — no installation required — and now supports both desktop and mobile devices.

## Features

### Desktop Experience
- **Windowed multitasking** — drag, resize, minimize, maximize, and close app windows
- **Start menu & taskbar** — launch apps, check the clock, switch between open windows
- **Right-click desktop** — refresh, cycle wallpapers, open settings or terminal
- **Alt+Tab** — cycle through open windows on desktop
- **Wallpapers** — three built-in stock images (sunset mountains, digital aurora, moonlit ocean) plus three gradient backgrounds; right-click the desktop and select "Next Wallpaper" to cycle

### Mobile Support
- **Responsive layout** — the desktop automatically switches to a mobile-optimized interface on screens 768px or narrower
- **App drawer** — tap the Apps button in the bottom dock to open a grid of all available apps
- **Full-screen windows** — apps open maximized on mobile with a top bar for back/close controls
- **Touch gestures** — drag windows by their title bar, tap to focus, swipe to navigate
- **Bottom dock** — quick access to Apps, Shell, Logos, Hub, and Settings

### Applications
- **File Explorer** — browse and manage virtual files
- **Terminal** — run shell commands with history
- **Notepad** — quick notes with pin support
- **Diagrammer** — create and save Mermaid diagrams
- **MindMap** — build and save mind maps
- **Chorus Editor** — music composition tool
- **Web Browser** — browse the web in an iframe
- **Canvas Paint** — drawing and painting
- **Media Player** — audio playback
- **Gallery** — image viewer
- **Game Hub** — launch mini-games
- **Logos Agent** — AI agent interface
- **Ouro-Hub** — hub for tools and resources
- **Control Panel** — system settings, wallpaper, themes, runtime management
- **Task Manager** — monitor open windows and bus traffic
- **Subkernel** — system diagnostics
- **Numogram Drift** — experimental tool

### Persistence
Bliss OS uses a Supabase database to persist data across sessions:
- Virtual file system (files and folders)
- Notes and diagrams
- Mind maps
- App settings
- Window session layouts
- Terminal command history

## Tech Stack
- **Frontend:** React + TypeScript + Vite
- **UI:** Material UI components
- **Backend:** Supabase (PostgreSQL database, row-level security)
- **Build:** Vite with hot module replacement

## Getting Started
The dev server runs automatically. For production builds:

```bash
npm run build
```

This compiles TypeScript and bundles with Vite into the `dist/` directory.
