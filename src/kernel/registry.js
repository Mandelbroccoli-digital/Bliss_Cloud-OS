'use strict';

export const NODE_STYLE = {
  app: { icon: '📦', color: '#38bdf8', label: 'Application' },
  window: { icon: '🪟', color: '#818cf8', label: 'Window' },
  process: { icon: '⚙️', color: '#34d399', label: 'Process' },
  file: { icon: '📄', color: '#fbbf24', label: 'File' },
  dir: { icon: '📁', color: '#f59e0b', label: 'Directory' },
  agent: { icon: '🤖', color: '#a78bfa', label: 'Agent' },
  service: { icon: '🧩', color: '#22d3ee', label: 'Service' },
  unknown: { icon: '❓', color: '#94a3b8', label: 'Node' },
};

export const EDGE_STYLE = {
  contains: { color: '#f59e0b', label: 'contains', dash: [] },
  launches: { color: '#38bdf8', label: 'launches', dash: [7, 5] },
  opens: { color: '#fbbf24', label: 'opens', dash: [2, 4] },
  owns: { color: '#34d399', label: 'owns', dash: [7, 5] },
  communicates: { color: '#a78bfa', label: 'communicates', dash: [3, 3] },
  mounts: { color: '#22d3ee', label: 'mounts', dash: [9, 5] },
  spawns: { color: '#f472b6', label: 'spawns', dash: [4, 3] },
  reads: { color: '#7dd3fc', label: 'reads', dash: [1, 3] },
  writes: { color: '#fb7185', label: 'writes', dash: [1, 3] },
};

export const APPS = {
  floret: {
    title: 'Floret',
    icon: '🌸',
    uri: 'src/apps/floret.html',
    size: [1000, 660],
    kind: 'app',
    pinned: true,
    capabilities: { fs: ['read'] },
    blurb: 'Spatial projection of the canonical node graph.',
  },
  logos: {
    title: 'Logos',
    icon: '🦀',
    uri: 'src/apps/logos.html',
    size: [860, 580],
    kind: 'agent',
    pinned: true,
    capabilities: { fs: ['read', 'write'], ai: ['gemini-3.8-flash'] },
    blurb: 'Subkernel intelligence & autopoietic AI agent (Gemini 3.8).',
  },
  explorer: {
    title: 'Explorer',
    icon: '📂',
    uri: 'src/apps/explorer.html',
    size: [820, 540],
    kind: 'utility',
    pinned: true,
    blurb: 'Filesystem browser over the Origin Private File System.',
  },
  notepad: {
    title: 'Notepad',
    icon: '📝',
    uri: 'src/apps/notepad.html',
    size: [740, 540],
    kind: 'app',
    pinned: true,
    fileTypes: ['txt', 'md', 'json', 'js', 'mjs', 'ts', 'html', 'css', 'svg', 'log', 'toml', 'py', 'rs', 'go', 'c', 'yml', 'yaml'],
    blurb: 'Text editor backed by real files.',
  },
  terminal: {
    title: 'Terminal',
    icon: '⌨️',
    uri: 'src/apps/terminal.html',
    size: [800, 460],
    kind: 'utility',
    pinned: true,
    capabilities: { fs: ['read', 'write', 'exec'] },
    blurb: 'Kernel command surface — drives the graph and the filesystem.',
  },
  inspector: {
    title: 'Graph Store',
    icon: '🕸️',
    uri: 'src/apps/inspector.html',
    size: [1020, 640],
    kind: 'utility',
    pinned: true,
    blurb: 'Canonical graph, transaction log, time travel and the bus monitor.',
  },
  taskmanager: {
    title: 'Task Manager',
    icon: '📊',
    uri: 'src/apps/taskmanager.html',
    size: [900, 580],
    kind: 'utility',
    pinned: true,
    blurb: 'Processes, windows and kernel throughput.',
  },
  controlpanel: {
    title: 'Control Panel',
    icon: '🎛️',
    uri: 'src/apps/controlpanel.html',
    size: [720, 560],
    kind: 'utility',
    pinned: true,
    blurb: 'Theme, wallpaper, storage and graph snapshots.',
  },
  player: {
    title: 'Media Player',
    icon: '🎵',
    uri: 'src/apps/player.html',
    size: [780, 600],
    kind: 'app',
    pinned: true,
    capabilities: { fs: ['read'] },
    fileTypes: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'opus'],
    blurb: 'Web Audio playback, EQ and a library indexed into the graph.',
  },
  viewer: {
    title: 'Viewer',
    icon: '👁️',
    uri: 'src/apps/viewer.html',
    size: [760, 560],
    kind: 'app',
    pinned: true,
    fileTypes: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'mp4', 'webm'],
    blurb: 'Image, audio and video preview.',
  },
  about: {
    title: 'About CloudOS',
    icon: '💠',
    uri: 'src/apps/about.html',
    size: [680, 560],
    kind: 'utility',
    pinned: true,
    blurb: 'What this thing is and how to drive it.',
  },
};

export const DESKTOP_ORDER = ['floret', 'logos', 'explorer', 'notepad', 'terminal', 'inspector', 'taskmanager', 'player', 'viewer', 'controlpanel', 'about'];

export const THEME = {
  dark: {
    label: 'Obsidian',
    desktopBg: 'linear-gradient(135deg, #060a10 0%, #0f172a 55%, #1e1b4b 100%)',
    accent: '#38bdf8',
  },
  xp: {
    label: 'Windows XP',
    desktopBg: 'linear-gradient(160deg, #5b8fe0 0%, #2f6fd0 45%, #1b4fae 100%)',
    accent: '#245edb',
  },
};

export function resolveApp(fileName, preferred) {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  if (preferred && APPS[preferred]) return preferred;
  for (const [id, app] of Object.entries(APPS)) {
    if (app.fileTypes && app.fileTypes.includes(ext)) return id;
  }
  return 'viewer';
}

export function appMeta(id) {
  return APPS[id] || { title: id, icon: '📦', uri: `src/apps/${id}.html`, kind: 'app' };
}
