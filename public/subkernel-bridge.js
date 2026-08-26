/**
 * Bliss_26 Subkernel Bridge
 * -------------------------
 * The app registry and window-control façade. Any surface — desktop
 * shell, iframe app, or native window — uses the same call to open,
 * focus, close, or message an app. The shell (index.html) owns the
 * actual windows; everyone else drives them over the bus.
 */
(() => {
  if (window.SubkernelBridge) return;

  // Canonical registry. `key` is the window id used everywhere.
  const APPS = {
    hub:            { uri: 'apps/hub.html',            icon: '🌀', title: 'Ouro-Hub',        kind: 'system' },
    explorer:       { uri: 'apps/explorer.html',       icon: '📂', title: 'Explorer',        kind: 'app' },
    taskmanager:    { uri: 'apps/taskmanager.html',    icon: '🖥️', title: 'Task Manager',    kind: 'system' },
    controlpanel:   { uri: 'apps/control-panel.html',  icon: '⚙️', title: 'Control Panel',   kind: 'system' },
    mermaid:        { uri: 'apps/mermaid.html',        icon: '🧜‍♂️', title: 'Diagrammer',    kind: 'app' },
    mindmap:        { uri: 'apps/mindmap.html',        icon: '🌸', title: 'Floret',          kind: 'app' },
    terminal:       { uri: 'apps/terminal.html',       icon: '💻', title: 'Terminal',        kind: 'app' },
    notepad:        { uri: 'apps/notepad.html',        icon: '📃', title: 'Notepad',         kind: 'app' },
    'chorus-editor':{ uri: 'apps/chorus-editor.html',  icon: '🎼', title: 'Chorus Editor',   kind: 'app' },
    browser:        { uri: 'apps/browser.html',        icon: '🌎', title: 'Browser',         kind: 'app' },
    logos:          { uri: 'apps/logos.html',          icon: '🦀', title: 'Logos',           kind: 'system' },
    gamehub:        { uri: 'apps/gamehub.html',        icon: '🎮', title: 'Game Hub',        kind: 'app' },
    gallery:        { uri: 'apps/gallery.html',        icon: '🖼️', title: 'Gallery',         kind: 'app' },
    player:         { uri: 'apps/player.html',         icon: '🎵', title: 'Media Player',    kind: 'app' },
    paint:          { uri: 'apps/paint.html',          icon: '🎨', title: 'Paint',           kind: 'app' },
    settings:       { uri: 'apps/settings.html',       icon: '🔧', title: 'Settings',        kind: 'system' },
    substrate:      { uri: 'games/Substrate/index.html', icon: '🌍', title: 'Substrate',      kind: 'app' },
  };

  // Which app opens which file type. Explorer and the shell share this.
  const ASSOCIATIONS = {
    player:  ['mp3','flac','wav','ogg','m4a','aac','mp4','mkv','avi','webm'],
    gallery: ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif','mov','m4v'],
    browser: ['html','htm','xhtml','pdf'],
    mermaid: ['mmd','mermaid'],
    'chorus-editor': ['chorus','chorx','cpdx','scroll','sml','py','rs','js','ts','json','toml'],
    notepad: ['txt','md','log','ini','cfg','csv','yaml','yml'],
  };

  const appForFile = (name = '') => {
    const ext = name.split('.').pop().toLowerCase();
    for (const [app, exts] of Object.entries(ASSOCIATIONS)) {
      if (exts.includes(ext)) return app;
    }
    return 'notepad';
  };

  const isTauri = '__TAURI_INTERNALS__' in window || !!window.__TAURI__;

  const bus = () => window.subkernel;

  const Bridge = {
    APPS,
    ASSOCIATIONS,
    appForFile,
    isTauri,

    /** Am I the shell that actually owns windows? */
    get isShell() {
      return typeof window.launchApp === 'function' && window.__blissShell === true;
    },

    /**
     * Open an app. If the shell is this window, open directly; otherwise
     * ask the shell over the bus. `opts.file` routes a file into the app.
     */
    openApp(key, opts = {}) {
      const id = APPS[key] ? key : key.replace(/\.html$/, '').replace(/^apps\//, '');
      if (this.isShell) {
        window.launchApp(id, opts);
      } else {
        bus()?.emit('Shell', 'open-app', { app: id, ...opts });
      }
      return id;
    },

    /** Back-compat alias used by older panels. */
    launch(key, opts = {}) {
      return this.openApp(key, opts);
    },

    /** Open a filesystem path with its associated app. */
    openPath(path, name = null) {
      const label = name || String(path).split(/[\\/]/).pop();
      const app = appForFile(label);
      return this.openApp(app, { file: path, filename: label });
    },

    closeApp(id)    { bus()?.emit('Shell', 'close-app',    { app: id }); },
    focusApp(id)    { bus()?.emit('Shell', 'focus-app',    { app: id }); },
    minimizeApp(id) { bus()?.emit('Shell', 'minimize-app', { app: id }); },
    maximizeApp(id) { bus()?.emit('Shell', 'maximize-app', { app: id }); },

    /** Kernel invoke, surfaced here so panels don't reach for Tauri directly. */
    invoke(cmd, args = {}) {
      return bus()
        ? bus().invoke(cmd, args)
        : Promise.reject(new Error('subkernel bus not loaded'));
    },

    get hasKernel() {
      return !!bus()?.hasKernel;
    },

    /** Which app am I? Derived from the page filename. */
    selfId() {
      const page = location.pathname.split('/').pop().replace('.html', '');
      const map = { 'control-panel': 'controlpanel', index: 'shell' };
      return map[page] || page;
    },
  };

  window.SubkernelBridge = Bridge;

  // Delegated launcher for [data-launch] elements.
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-launch]');
    if (!el) return;
    e.preventDefault();
    Bridge.openApp(el.dataset.launch);
  });
})();
