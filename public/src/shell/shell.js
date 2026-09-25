'use strict';

const MIN_W = 320;
const MIN_H = 220;
const TASKBAR_H = 32;

export function createShell(kernel) {
  const bus = kernel.bus;
  const graph = kernel.graph;
  const state = kernel.state;
  const APPS = kernel.APPS;
  const DESKTOP_ORDER = kernel.DESKTOP_ORDER;
  const WALLPAPERS = kernel.WALLPAPERS;
  const appMeta = kernel.appMeta;

  const wins = new Map();
  const textCache = new Map();
  const NODE_ID_OF = kernel.NODE_ID;
  let kitText = '';
  let cssText = '';
  let zTop = 10;
  let focused = null;
  let switcherIndex = 0;
  let statusTimer = null;
  let reconcileTimer = null;
  let reconciling = false;
  let booted = false;

  const dom = {
    desktop: document.getElementById('desktop'),
    icons: document.getElementById('icon-layer'),
    windows: document.getElementById('window-layer'),
    tabs: document.getElementById('task-tabs'),
    startBtn: document.getElementById('start-btn'),
    startMenu: document.getElementById('start-menu'),
    trayStatus: document.getElementById('tray-status'),
    clock: document.getElementById('tray-clock'),
    ctx: document.getElementById('ctx-menu'),
    switcher: document.getElementById('switcher'),
    switcherList: document.getElementById('switcher-list'),
    veil: document.getElementById('boot-veil'),
    veilSub: document.getElementById('boot-veil-sub'),
    veilBar: document.getElementById('boot-veil-bar'),
    flash: document.getElementById('flash-overlay'),
    trayLed: document.getElementById('tray-led'),
  };

  function veil(text, progress) {
    if (!dom.veilSub) return;
    if (text) dom.veilSub.textContent = text;
    if (progress != null && dom.veilBar) dom.veilBar.style.width = Math.round(progress * 100) + '%';
  }

  async function fetchText(path) {
    if (textCache.has(path)) return textCache.get(path);
    const response = await fetch(path);
    if (!response.ok) throw new Error('fetch failed ' + path + ' (' + response.status + ')');
    const text = await response.text();
    textCache.set(path, text);
    return text;
  }

  function appFile(appId) {
    return appMeta(appId).uri || `src/apps/${appId}.html`;
  }

  async function buildAppDoc(appId, instance, boot) {
    const template = await fetchText(appFile(appId));
    const payload = JSON.stringify(Object.assign({ app: appId, instance, windowId: instance }, boot || {}));
    const inject =
      '<script>window.CLOUDOS_BOOT=' + payload + ';<\/script>\n' +
      '<script>\n' + kitText + '\n</script>\n' +
      '<style>\n' + cssText + '\n</style>\n';
    if (template.includes('<!--cloudos-head-->')) return template.replace('<!--cloudos-head-->', inject);
    return template.replace(/<head([^>]*)>/i, (match) => match + '\n' + inject);
  }

  function desktopRect() {
    return dom.desktop.getBoundingClientRect();
  }

  function nextBounds(meta) {
    const rect = desktopRect();
    const width = Math.min(meta.size ? meta.size[0] : 720, Math.max(MIN_W, rect.width - 40));
    const height = Math.min(meta.size ? meta.size[1] : 520, Math.max(MIN_H, rect.height - 40));
    const count = wins.size;
    const offset = (count % 6) * 26;
    let left = Math.round((rect.width - width) / 2) + offset - 60;
    let top = Math.round((rect.height - height) / 2) + offset - 50;
    left = Math.max(8, Math.min(left, rect.width - width - 8));
    top = Math.max(8, Math.min(top, rect.height - height - 8));
    return { x: left, y: top, w: width, h: height };
  }

  function clampBounds(bounds) {
    const rect = desktopRect();
    const out = Object.assign({}, bounds);
    out.w = Math.max(MIN_W, Math.min(out.w, rect.width - 4));
    out.h = Math.max(MIN_H, Math.min(out.h, rect.height - 4));
    out.x = Math.max(-out.w + 120, Math.min(out.x, rect.width - 90));
    out.y = Math.max(0, Math.min(out.y, rect.height - 34));
    return out;
  }

  function applyBounds(rec, bounds) {
    rec.bounds = clampBounds(bounds);
    const el = rec.el;
    el.style.left = rec.bounds.x + 'px';
    el.style.top = rec.bounds.y + 'px';
    el.style.width = rec.bounds.w + 'px';
    el.style.height = rec.bounds.h + 'px';
  }

  function persist(rec, extra) {
    kernel.setWindow(rec.instance, Object.assign({}, rec.bounds, {
      minimized: rec.minimized,
      maximized: rec.maximized,
      docked: rec.docked,
      file: rec.file,
      title: rec.title,
    }, extra || {}));
  }

  function titleFor(appId, file, explicit) {
    if (explicit) return explicit;
    const meta = appMeta(appId);
    return file ? `${meta.title} — ${String(file).split('/').pop()}` : meta.title;
  }

  async function openApp(appId, options = {}) {
    const meta = appMeta(appId);
    if (!meta || !meta.uri) {
      setStatus('Unknown application: ' + appId);
      return null;
    }
    if (options.instance && wins.has(options.instance)) {
      focusWindow(options.instance);
      return options.instance;
    }
    if (options.file && options.reuse !== false && !options.instance) {
      const existing = [...wins.values()].find((rec) => rec.appId === appId && rec.file === options.file);
      if (existing) {
        focusWindow(existing.instance);
        return existing.instance;
      }
    }
    if (options.reuse !== false && !options.instance) {
      const sibling = [...wins.values()].find((rec) => rec.appId === appId);
      const fileScoped = !!(meta.fileTypes && meta.fileTypes.length);
      if (sibling && (!fileScoped || !options.file)) {
        focusWindow(sibling.instance);
        if (options.file && sibling.file !== options.file) {
          sibling.file = options.file;
          setWindowTitle(sibling.instance, titleFor(appId, options.file));
          persist(sibling);
          bus.emit(appId, 'open-file', { path: options.file, filename: options.filename || String(options.file).split('/').pop() });
        }
        return sibling.instance;
      }
    }

    const bounds = options.bounds
      ? clampBounds(options.bounds)
      : nextBounds(meta);
    let instance;
    if (options.fromGraph && options.instance) {
      instance = options.instance;
    } else {
      const created = kernel.openWindow(appId, {
        instanceId: options.instance || null,
        x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h,
        file: options.file || null,
        title: titleFor(appId, options.file, options.title),
      });
      instance = created.instance;
    }

    const rec = createWindowElement(instance, appId, bounds, {
      file: options.file || null,
      title: options.title || null,
      minimized: !!options.minimized,
      maximized: !!options.maximized,
      docked: options.docked || null,
    });
    wins.set(instance, rec);
    bus.emit('Shell', 'window-opened', { instance, appId, file: rec.file || null });
    focusWindow(instance);
    renderTabs();
    announce();

    try {
      const doc = await buildAppDoc(appId, instance, {
        file: options.file || null,
        filename: options.filename || (options.file ? String(options.file).split('/').pop() : null),
        title: rec.title,
      });
      rec.frame.srcdoc = doc;
    } catch (error) {
      rec.frame.srcdoc =
        '<body style="font:12px monospace;padding:18px;background:#0d1420;color:#fb7185">Failed to mount ' +
        appId + ': ' + String(error.message) + '</body>';
    }
    return instance;
  }

  function createWindowElement(instance, appId, bounds, options) {
    const meta = appMeta(appId);
    const el = document.createElement('div');
    el.className = 'win';
    el.dataset.instance = instance;
    el.dataset.app = appId;

    const titleBar = document.createElement('div');
    titleBar.className = 'win-title';

    const icon = document.createElement('span');
    icon.className = 't-ico';
    icon.textContent = meta.icon || '📦';

    const name = document.createElement('span');
    name.className = 't-name';

    const doseg = document.createElement('span');
    doseg.className = 't-doseg';
    doseg.textContent = '';

    const buttons = document.createElement('div');
    buttons.className = 'win-btns';

    const mkBtn = (cls, label, title, handler) => {
      const button = document.createElement('button');
      button.className = 'wb ' + cls;
      button.textContent = label;
      button.title = title;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        handler();
      });
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      buttons.appendChild(button);
      return button;
    };

    const bodyEl = document.createElement('div');
    bodyEl.className = 'win-body';
    const frame = document.createElement('iframe');
    frame.className = 'win-frame';
    frame.setAttribute('title', meta.title);
    bodyEl.appendChild(frame);

    titleBar.appendChild(icon);
    titleBar.appendChild(name);
    titleBar.appendChild(doseg);
    titleBar.appendChild(buttons);
    el.appendChild(titleBar);
    el.appendChild(bodyEl);

    ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].forEach((dir) => {
      const handle = document.createElement('div');
      handle.className = 'rz rz-' + dir;
      handle.dataset.dir = dir;
      el.appendChild(handle);
    });

    dom.windows.appendChild(el);

    const rec = {
      instance,
      appId,
      el,
      frame,
      titleBar,
      nameEl: name,
      dosegEl: doseg,
      file: options.file || null,
      title: titleFor(appId, options.file, options.title),
      bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
      minimized: !!options.minimized,
      maximized: !!options.maximized,
      docked: options.docked || null,
      restoreBounds: null,
      closed: false,
    };

    name.textContent = rec.title;
    applyBounds(rec, rec.bounds);
    if (rec.minimized) el.classList.add('minimized');
    if (rec.maximized) {
      rec.restoreBounds = Object.assign({}, rec.bounds);
      el.classList.add('maximized');
      applyBounds(rec, { x: 0, y: 0, w: desktopRect().width, h: desktopRect().height });
    } else if (rec.docked) {
      rec.restoreBounds = Object.assign({}, rec.bounds);
      applyBounds(rec, dockBounds(rec.docked));
    }
    rec.dosegEl.textContent = String(instance).slice(-6);

    mkBtn('min', '–', 'Minimize', () => minimizeWindow(instance));
    mkBtn('max', '❐', 'Maximize', () => toggleMaximize(instance));
    mkBtn('close', '✕', 'Close', () => closeWindow(instance));

    el.addEventListener('pointerdown', () => focusWindow(instance), true);
    titleBar.addEventListener('pointerdown', (event) => beginDrag(rec, event));
    titleBar.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showWindowMenu(rec, event.clientX, event.clientY);
    });
    el.querySelectorAll('.rz').forEach((handle) => {
      handle.addEventListener('pointerdown', (event) => beginResize(rec, handle.dataset.dir, event));
    });

    return rec;
  }

  function iframesInteractive(enabled) {
    if (!enabled) {
      wins.forEach((rec) => {
        rec.frame.style.pointerEvents = 'none';
      });
    } else {
      wins.forEach((rec) => {
        rec.frame.style.pointerEvents = '';
      });
    }
  }

  function beginDrag(rec, event) {
    if (event.button !== 0) return;
    if (event.target.closest('.wb')) return;
    focusWindow(rec.instance);

    if (rec.maximized || rec.docked) {
      const restore = rec.restoreBounds || { w: Math.round(desktopRect().width * 0.62), h: Math.round(desktopRect().height * 0.7) };
      const ratio = (event.clientX - rec.el.offsetLeft) / Math.max(1, rec.bounds.w);
      rec.maximized = false;
      rec.docked = null;
      rec.el.classList.remove('maximized');
      applyBounds(rec, { x: event.clientX - restore.w * ratio, y: 6, w: restore.w, h: restore.h });
      rec.restoreBounds = null;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: rec.bounds.x, y: rec.bounds.y };
    rec.titleBar.setPointerCapture(event.pointerId);
    iframesInteractive(false);

    const move = (moveEvent) => {
      applyBounds(rec, { x: origin.x + (moveEvent.clientX - startX), y: origin.y + (moveEvent.clientY - startY), w: rec.bounds.w, h: rec.bounds.h });
    };
    const up = () => {
      rec.titleBar.removeEventListener('pointermove', move);
      iframesInteractive(true);
      persist(rec);
      announce();
    };
    rec.titleBar.addEventListener('pointermove', move);
    rec.titleBar.addEventListener('pointerup', up, { once: true });
    rec.titleBar.addEventListener('pointercancel', up, { once: true });
  }

  function beginResize(rec, dir, event) {
    if (event.button !== 0) return;
    if (rec.maximized || rec.docked) return;
    event.stopPropagation();
    focusWindow(rec.instance);

    const startX = event.clientX;
    const startY = event.clientY;
    const origin = Object.assign({}, rec.bounds);
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    iframesInteractive(false);

    const move = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      let { x, y, w, h } = origin;
      if (dir.includes('e')) w = origin.w + dx;
      if (dir.includes('s')) h = origin.h + dy;
      if (dir.includes('w')) {
        w = origin.w - dx;
        x = origin.x + dx;
      }
      if (dir.includes('n')) {
        h = origin.h - dy;
        y = origin.y + dy;
      }
      if (w < MIN_W) {
        if (dir.includes('w')) x -= MIN_W - w;
        w = MIN_W;
      }
      if (h < MIN_H) {
        if (dir.includes('n')) y -= MIN_H - h;
        h = MIN_H;
      }
      applyBounds(rec, { x, y, w, h });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      iframesInteractive(true);
      persist(rec);
      announce();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  }

  function dockBounds(side) {
    const rect = desktopRect();
    const w = Math.round(rect.width / 2);
    return side === 'left' ? { x: 0, y: 0, w, h: rect.height } : { x: w, y: 0, w: rect.width - w, h: rect.height };
  }

  function focusWindow(instance) {
    const rec = wins.get(instance);
    if (!rec) return;
    zTop += 1;
    rec.el.style.zIndex = String(zTop);
    focused = instance;
    state.focused = instance;
    if (rec.minimized) restoreWindow(instance);
    renderTabs();
    announce();
  }

  function minimizeWindow(instance) {
    const rec = wins.get(instance);
    if (!rec) return;
    rec.minimized = true;
    rec.el.classList.add('minimized');
    if (focused === instance) focused = null;
    persist(rec);
    renderTabs();
    announce();
  }

  function restoreWindow(instance) {
    const rec = wins.get(instance);
    if (!rec) return;
    rec.minimized = false;
    rec.el.classList.remove('minimized');
    persist(rec);
  }

  function toggleMaximize(instance) {
    const rec = wins.get(instance);
    if (!rec) return;
    if (rec.maximized) {
      rec.maximized = false;
      rec.el.classList.remove('maximized');
      if (rec.restoreBounds) applyBounds(rec, rec.restoreBounds);
      rec.restoreBounds = null;
    } else {
      rec.restoreBounds = Object.assign({}, rec.bounds);
      rec.docked = null;
      rec.maximized = true;
      rec.el.classList.add('maximized');
      applyBounds(rec, { x: 0, y: 0, w: desktopRect().width, h: desktopRect().height });
    }
    focusWindow(instance);
    persist(rec);
    announce();
  }

  function dockWindow(instance, side) {
    const rec = wins.get(instance);
    if (!rec) return;
    if (!rec.restoreBounds) rec.restoreBounds = Object.assign({}, rec.bounds);
    rec.maximized = false;
    rec.el.classList.remove('maximized');
    rec.docked = side;
    applyBounds(rec, dockBounds(side));
    focusWindow(instance);
    persist(rec);
    announce();
  }

  function closeWindow(instance) {
    const rec = wins.get(instance);
    if (!rec || rec.closed) return;
    rec.closed = true;
    rec.el.classList.add('closing');
    setTimeout(() => {
      rec.el.remove();
      wins.delete(instance);
      kernel.closeWindow(instance);
      if (focused === instance) focused = null;
      renderTabs();
      announce();
    }, 160);
  }

  function setWindowTitle(instance, title) {
    const rec = wins.get(instance);
    if (!rec) return;
    rec.title = title;
    rec.nameEl.textContent = title;
    renderTabs();
    kernel.setWindow(instance, { title });
  }

  function allWindows() {
    return [...wins.values()].map((rec) => ({
      instance: rec.instance,
      appId: rec.appId,
      title: rec.title,
      file: rec.file,
      minimized: rec.minimized,
      maximized: rec.maximized,
      docked: rec.docked,
      bounds: Object.assign({}, rec.bounds),
      focused: rec.instance === focused,
      z: parseInt(rec.el.style.zIndex || '0', 10),
    }));
  }

  const TASKBAR_STORAGE_KEY = 'cloudos.taskbar.tabs.v1';

  function saveTaskbarTabs() {
    try {
      const tabs = [...wins.values()].map((rec) => ({
        instance: rec.instance,
        appId: rec.appId,
        title: rec.title,
        file: rec.file || null,
        minimized: !!rec.minimized,
        maximized: !!rec.maximized,
        docked: rec.docked || null,
        bounds: Object.assign({}, rec.bounds),
        focused: rec.instance === focused,
        z: parseInt(rec.el.style.zIndex || '0', 10),
      }));
      localStorage.setItem(TASKBAR_STORAGE_KEY, JSON.stringify({
        tabs,
        focused,
        timestamp: Date.now(),
      }));
    } catch (e) {
      console.warn('[Shell] failed to save taskbar tabs to localStorage', e);
    }
  }

  function readTaskbarTabs() {
    try {
      const raw = localStorage.getItem(TASKBAR_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.tabs)) return parsed;
      if (Array.isArray(parsed)) return { tabs: parsed, focused: null };
      return null;
    } catch {
      return null;
    }
  }

  function announce() {
    const list = allWindows();
    state.windows = list;
    bus.emit('Shell', 'windows', { windows: list });
    saveTaskbarTabs();
  }

  function reconcile() {
    if (!booted || reconciling) return;
    reconciling = true;
    try {
      const store = graph.store;
      store.ofType('window').forEach((node) => {
        if (!node.instance || wins.has(node.instance) || !node.appId) return;
        if (!appMeta(node.appId).uri) return;
        setStatus('restoring ' + (node.title || node.appId) + ' from the graph');
        openApp(node.appId, {
          instance: node.instance,
          bounds: { x: node.x, y: node.y, w: node.w, h: node.h },
          file: node.file || null,
          title: node.title || null,
          minimized: !!node.minimized,
          maximized: !!node.maximized,
          docked: node.docked || null,
          reuse: false,
          fromGraph: true,
        });
      });
      [...wins.values()].forEach((rec) => {
        if (rec.closed) return;
        if (!store.hasNode(NODE_ID_OF.window(rec.instance))) {
          rec.closed = true;
          rec.el.remove();
          wins.delete(rec.instance);
          if (focused === rec.instance) focused = null;
          renderTabs();
          announce();
        }
      });
    } finally {
      reconciling = false;
    }
  }

  function queueReconcile() {
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(reconcile, 160);
  }

  function renderTabs() {
    dom.tabs.innerHTML = '';
    wins.forEach((rec) => {
      const tab = document.createElement('div');
      tab.className = 'task-tab' + (rec.instance === focused && !rec.minimized ? ' active' : '');
      tab.title = rec.title + '  (' + rec.appId + ')';
      const ico = document.createElement('span');
      ico.textContent = appMeta(rec.appId).icon || '📦';
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = rec.title;
      tab.appendChild(ico);
      tab.appendChild(nm);
      tab.addEventListener('click', () => {
        if (rec.instance === focused && !rec.minimized) minimizeWindow(rec.instance);
        else {
          restoreWindow(rec.instance);
          focusWindow(rec.instance);
        }
      });
      tab.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        showWindowMenu(rec, event.clientX, event.clientY);
      });
      dom.tabs.appendChild(tab);
    });
    saveTaskbarTabs();
  }

  function tileWindows() {
    const list = [...wins.values()].filter((rec) => !rec.minimized);
    if (!list.length) return;
    const rect = desktopRect();
    const cols = Math.ceil(Math.sqrt(list.length));
    const rows = Math.ceil(list.length / cols);
    const cw = Math.floor(rect.width / cols);
    const ch = Math.floor(rect.height / rows);
    list.forEach((rec, index) => {
      rec.maximized = false;
      rec.docked = null;
      rec.el.classList.remove('maximized');
      applyBounds(rec, { x: (index % cols) * cw, y: Math.floor(index / cols) * ch, w: cw - 4, h: ch - 4 });
      persist(rec);
    });
    announce();
  }

  function cascadeWindows() {
    const list = [...wins.values()].filter((rec) => !rec.minimized);
    list.forEach((rec, index) => {
      rec.maximized = false;
      rec.docked = null;
      rec.el.classList.remove('maximized');
      applyBounds(rec, { x: 24 + index * 28, y: 20 + index * 26, w: Math.min(820, Math.round(desktopRect().width * 0.66)), h: Math.min(560, Math.round(desktopRect().height * 0.72)) });
      persist(rec);
    });
    announce();
  }

  function setStatus(text) {
    dom.trayStatus.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      dom.trayStatus.textContent = '';
    }, 5200);
  }

  function flashWindow(instance) {
    const rec = wins.get(instance);
    if (!rec) return;
    dom.flash.classList.remove('on');
    if (dom.flash.offsetWidth) dom.flash.offsetWidth;
    dom.flash.classList.add('on');
    rec.el.animate(
      [{ outline: '2px solid ' + getComputedStyle(document.documentElement).getPropertyValue('--accent') }, { outline: '2px solid transparent' }],
      { duration: 900, iterations: 2 }
    );
  }

  const ICON_STORAGE_KEY = 'cloudos.desktop.icons.v1';

  const ICON_SIZE_MAP = {
    small: { size: '24px', containerW: '75px', containerH: '85px', fontSize: '10px' },
    medium: { size: '32px', containerW: '95px', containerH: '105px', fontSize: '11px' },
    large: { size: '48px', containerW: '115px', containerH: '125px', fontSize: '12px' },
  };

  function readIconSettings() {
    try {
      const raw = localStorage.getItem(ICON_STORAGE_KEY);
      if (!raw) return { size: 'medium', showIcons: true };
      const parsed = JSON.parse(raw);
      return {
        size: (parsed && parsed.size in ICON_SIZE_MAP) ? parsed.size : 'medium',
        showIcons: parsed && parsed.showIcons !== false,
      };
    } catch {
      return { size: 'medium', showIcons: true };
    }
  }

  let iconSettings = readIconSettings();

  function applyIconSettings() {
    const config = ICON_SIZE_MAP[iconSettings.size] || ICON_SIZE_MAP.medium;
    if (dom.icons) {
      dom.icons.style.display = iconSettings.showIcons ? 'grid' : 'none';
      dom.icons.style.setProperty('--icon-size', config.size);
      dom.icons.style.setProperty('--icon-container-width', config.containerW);
      dom.icons.style.setProperty('--icon-container-height', config.containerH);
      dom.icons.style.setProperty('--icon-font-size', config.fontSize);
    }
    try {
      localStorage.setItem(ICON_STORAGE_KEY, JSON.stringify(iconSettings));
    } catch (e) {
      /* ignore */
    }
  }

  function setIconSize(size) {
    if (size in ICON_SIZE_MAP) {
      iconSettings.size = size;
      applyIconSettings();
      setStatus('Desktop icons: ' + size);
    }
  }

  function toggleShowIcons() {
    iconSettings.showIcons = !iconSettings.showIcons;
    applyIconSettings();
    setStatus(iconSettings.showIcons ? 'Desktop icons visible' : 'Desktop icons hidden');
  }

  function showContextMenu(x, y, items) {
    dom.ctx.innerHTML = '';
    items.forEach((item) => {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        dom.ctx.appendChild(sep);
        return;
      }
      if (item.header) {
        const hdr = document.createElement('div');
        hdr.className = 'ctx-header';
        hdr.textContent = item.label;
        dom.ctx.appendChild(hdr);
        return;
      }
      const row = document.createElement('div');
      row.className = 'ctx-item' + (item.active ? ' active' : '') + (item.disabled ? ' disabled' : '');
      const label = document.createElement('span');
      label.textContent = (item.icon ? item.icon + '  ' : '') + item.label;
      row.appendChild(label);
      if (item.accel) {
        const accel = document.createElement('span');
        accel.className = 'accel';
        accel.textContent = item.accel;
        row.appendChild(accel);
      }
      row.addEventListener('click', () => {
        hideContextMenu();
        if (typeof item.run === 'function') item.run();
      });
      dom.ctx.appendChild(row);
    });
    dom.ctx.classList.add('open');
    const width = 230;
    const height = dom.ctx.offsetHeight + 8;
    dom.ctx.style.left = Math.min(x, window.innerWidth - width - 6) + 'px';
    dom.ctx.style.top = Math.min(y, window.innerHeight - height - 6) + 'px';
  }

  function hideContextMenu() {
    dom.ctx.classList.remove('open');
  }

  function showWindowMenu(rec, x, y) {
    showContextMenu(x, y, [
      { label: rec.minimized ? 'Restore' : 'Minimize', icon: '🗕', run: () => (rec.minimized ? (restoreWindow(rec.instance), focusWindow(rec.instance)) : minimizeWindow(rec.instance)) },
      { label: rec.maximized ? 'Restore size' : 'Maximize', icon: '🗖', run: () => toggleMaximize(rec.instance) },
      { separator: true },
      { label: 'Dock left half', icon: '⬅️', run: () => dockWindow(rec.instance, 'left') },
      { label: 'Dock right half', icon: '➡️', run: () => dockWindow(rec.instance, 'right') },
      { separator: true },
      { label: 'Inspect node in Graph Store', icon: '🕸️', run: () => openApp('inspector', { reuse: false, title: 'Graph Store — ' + rec.title }) },
      { label: 'Copy instance id', icon: '📋', run: () => navigator.clipboard && navigator.clipboard.writeText(rec.instance).then(() => setStatus('copied ' + rec.instance)) },
      { separator: true },
      { label: 'Close window', icon: '✕', run: () => closeWindow(rec.instance) },
    ]);
  }

  function showDesktopMenu(x, y) {
    const items = [
      { header: true, label: 'View Options' },
      {
        label: iconSettings.showIcons ? 'Hide Desktop Icons' : 'Show Desktop Icons',
        icon: iconSettings.showIcons ? '👁️' : '👁️‍🗨️',
        run: toggleShowIcons,
      },
      { separator: true },
      { header: true, label: 'Icon Size' },
      {
        label: (iconSettings.size === 'small' ? '● ' : '○ ') + 'Small Icons',
        icon: '▫️',
        active: iconSettings.size === 'small',
        run: () => setIconSize('small'),
      },
      {
        label: (iconSettings.size === 'medium' ? '● ' : '○ ') + 'Medium Icons',
        icon: '🔎',
        active: iconSettings.size === 'medium',
        run: () => setIconSize('medium'),
      },
      {
        label: (iconSettings.size === 'large' ? '● ' : '○ ') + 'Large Icons',
        icon: '🔍',
        active: iconSettings.size === 'large',
        run: () => setIconSize('large'),
      },
      { separator: true },
    ];

    DESKTOP_ORDER.slice(0, 6).forEach((id) => {
      items.push({
        label: 'Open ' + appMeta(id).title,
        icon: appMeta(id).icon,
        run: () => openApp(id),
      });
    });

    items.push(
      { separator: true },
      { label: 'Next wallpaper', icon: '🎨', run: () => cycleWallpaper(1) },
      { label: 'Toggle theme (dark / XP)', icon: '🌗', run: toggleTheme },
      { separator: true },
      { label: 'Tile windows', icon: '🧱', run: tileWindows },
      { label: 'Cascade windows', icon: '🃏', run: cascadeWindows },
      { label: 'Close all windows', icon: '🧹', run: closeAll },
      { separator: true },
      { label: 'Undo last commit', icon: '↩️', accel: 'Ctrl+Z', run: () => graph.undo() },
      { label: 'Commit a graph snapshot', icon: '📸', run: () => snapshotGraph() },
      { separator: true },
      { label: 'Reload shell (F6)', icon: '🔄', run: () => location.reload() }
    );
    showContextMenu(x, y, items);
  }

  function toggleTheme() {
    const current = kernel.theme();
    kernel.setTheme(current.mode === 'xp' ? 'dark' : 'xp');
  }

  function cycleWallpaper(delta) {
    const current = kernel.theme();
    kernel.setTheme(current.mode, (current.wallpaper + delta + WALLPAPERS.length) % WALLPAPERS.length);
  }

  function snapshotGraph() {
    const name = 'manual ' + new Date().toLocaleString();
    graph.snapshot(name);
    setStatus('snapshot saved: ' + name);
  }

  function closeAll() {
    [...wins.keys()].forEach(closeWindow);
  }

  function applyTheme() {
    const theme = kernel.theme();
    document.body.classList.toggle('xp-mode', theme.mode === 'xp');
    document.documentElement.dataset.theme = theme.mode;
    const node = graph.store.node('svc:theme') || {};
    const wp = WALLPAPERS[theme.wallpaper] || WALLPAPERS[0];
    const imageUrl = node.wallpaperUrl || wp.url || null;
    if (imageUrl) {
      dom.desktop.style.background = "url('" + imageUrl + "') center/cover no-repeat";
      dom.desktop.style.backgroundSize = 'cover';
      dom.desktop.style.backgroundPosition = 'center';
    } else {
      dom.desktop.style.background = wp.css + ' fixed';
      dom.desktop.style.backgroundSize = 'cover';
      dom.desktop.style.backgroundPosition = 'center';
      dom.desktop.style.backgroundRepeat = 'no-repeat';
    }
  }

  function renderIcons() {
    dom.icons.innerHTML = '';
    DESKTOP_ORDER.forEach((appId) => {
      const meta = appMeta(appId);
      const icon = document.createElement('div');
      icon.className = 'desk-icon';
      icon.dataset.app = appId;
      icon.innerHTML = '<span class="ico"></span><span class="lbl"></span>';
      icon.querySelector('.ico').textContent = meta.icon || '📦';
      icon.querySelector('.lbl').textContent = meta.title;
      icon.addEventListener('click', () => {
        [...dom.icons.children].forEach((child) => child.classList.remove('selected'));
        icon.classList.add('selected');
      });
      icon.addEventListener('dblclick', () => openApp(appId));
      icon.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showContextMenu(event.clientX, event.clientY, [
          { label: 'Open ' + meta.title, icon: meta.icon, run: () => openApp(appId) },
          { label: 'Open a new instance', icon: '➕', run: () => openApp(appId, { reuse: false }) },
          { separator: true },
          { label: 'Show as node in Floret', icon: '🌸', run: () => openApp('floret') },
          { label: 'Node id', icon: '🔖', run: () => setStatus('app:' + appId) },
        ]);
      });
      dom.icons.appendChild(icon);
    });
  }

  function renderStartMenu() {
    dom.startMenu.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'start-header';
    header.innerHTML = '<span style="font-size:18px">🪐</span><span>CloudOS</span><span style="margin-left:auto;font-size:9px;opacity:.7">nodegraph</span>';
    dom.startMenu.appendChild(header);

    const pinned = document.createElement('div');
    pinned.className = 'start-sub';
    pinned.textContent = 'Applications';
    dom.startMenu.appendChild(pinned);

    DESKTOP_ORDER.forEach((appId) => {
      const meta = appMeta(appId);
      const row = document.createElement('div');
      row.className = 'start-item';
      row.innerHTML = '<span class="si-ico"></span><span class="si-name"></span><span class="si-blurb"></span>';
      row.querySelector('.si-ico').textContent = meta.icon || '📦';
      row.querySelector('.si-name').textContent = meta.title;
      row.querySelector('.si-blurb').textContent = meta.blurb || '';
      row.addEventListener('click', () => {
        toggleStartMenu(false);
        openApp(appId);
      });
      dom.startMenu.appendChild(row);
    });

    dom.startMenu.appendChild(Object.assign(document.createElement('div'), { className: 'start-divider' }));
    const actions = [
      { icon: '🕸️', label: 'Graph Store', run: () => openApp('inspector') },
      { icon: '↩️', label: 'Undo last commit (Ctrl+Z)', run: () => graph.undo() },
      { icon: '📸', label: 'Snapshot graph', run: snapshotGraph },
      { icon: '🔄', label: 'Reload shell', run: () => location.reload() },
    ];
    actions.forEach((action) => {
      const row = document.createElement('div');
      row.className = 'start-item';
      row.innerHTML = '<span class="si-ico"></span>';
      row.querySelector('.si-ico').textContent = action.icon;
      row.appendChild(Object.assign(document.createElement('span'), { textContent: action.label }));
      row.addEventListener('click', () => {
        toggleStartMenu(false);
        action.run();
      });
      dom.startMenu.appendChild(row);
    });
  }

  function toggleStartMenu(force) {
    const open = force == null ? !dom.startMenu.classList.contains('open') : force;
    dom.startMenu.classList.toggle('open', open);
  }

  function renderSwitcher() {
    const list = [...wins.values()];
    dom.switcherList.innerHTML = '';
    if (!list.length) {
      dom.switcher.classList.remove('open');
      return;
    }
    if (switcherIndex >= list.length) switcherIndex = 0;
    list.forEach((rec, index) => {
      const row = document.createElement('div');
      row.className = 'switcher-row' + (index === switcherIndex ? ' selected' : '');
      row.innerHTML = '<span></span><span class="grow"></span><span class="dim mono" style="font-size:10px"></span>';
      row.children[0].textContent = appMeta(rec.appId).icon || '📦';
      row.children[1].textContent = rec.title;
      row.children[2].textContent = rec.minimized ? 'minimized' : rec.appId;
      row.addEventListener('click', () => {
        switcherIndex = index;
        commitSwitcher();
      });
      dom.switcherList.appendChild(row);
    });
  }

  function openSwitcher() {
    if (!wins.size) return;
    switcherIndex = Math.max(0, [...wins.keys()].indexOf(focused) + 1) % wins.size;
    renderSwitcher();
    dom.switcher.classList.add('open');
  }

  function commitSwitcher() {
    const list = [...wins.values()];
    const rec = list[switcherIndex];
    dom.switcher.classList.remove('open');
    if (rec) {
      restoreWindow(rec.instance);
      focusWindow(rec.instance);
    }
  }

  function tickClock() {
    const now = new Date();
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    dom.clock.textContent = hours + ':' + String(now.getMinutes()).padStart(2, '0') + ' ' + ampm;
    dom.clock.title = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
  }

  function cleanupOrphanProcesses() {
    const store = graph.store;
    const orphans = store.query({ type: 'process', where: (node) => !!node.appId }).map((node) => node.id);
    if (orphans.length) graph.commit({ label: 'reap orphaned processes', deleteNodes: orphans });
  }

  function handleHotkeys(event) {
    const target = event.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (event.key === 'Escape') {
      hideContextMenu();
      toggleStartMenu(false);
      dom.switcher.classList.remove('open');
      return;
    }
    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'z' && !typing) {
      event.preventDefault();
      graph.undo();
      setStatus('undo -> v' + graph.store.version);
      return;
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      graph.redo();
      setStatus('redo -> v' + graph.store.version);
      return;
    }
    if (event.ctrlKey && event.key === '`') {
      event.preventDefault();
      if (dom.switcher.classList.contains('open')) {
        switcherIndex = (switcherIndex + (event.shiftKey ? -1 : 1) + wins.size) % wins.size;
        renderSwitcher();
      } else {
        openSwitcher();
      }
      return;
    }
    if (dom.switcher.classList.contains('open')) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        switcherIndex = (switcherIndex + 1) % wins.size;
        renderSwitcher();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        switcherIndex = (switcherIndex - 1 + wins.size) % wins.size;
        renderSwitcher();
      } else if (event.key === 'Enter') {
        commitSwitcher();
      }
      return;
    }
    if (event.key === 'F6') {
      event.preventDefault();
      location.reload();
    }
  }

  function wireBus() {
    bus.on('Shell', 'open-app', ({ app, file, filename }) => openApp(app, { file, filename }));
    bus.on('Shell', 'close-app', ({ instance }) => closeWindow(instance));
    bus.on('Shell', 'focus-app', ({ instance }) => {
      restoreWindow(instance);
      focusWindow(instance);
    });
    bus.on('Shell', 'minimize-app', ({ instance }) => minimizeWindow(instance));
    bus.on('Shell', 'maximize-app', ({ instance }) => toggleMaximize(instance));
    bus.on('Shell', 'dock-app', ({ instance, side }) => dockWindow(instance, side));
    bus.on('Shell', 'set-title', ({ instance, title }) => setWindowTitle(instance, title));
    bus.on('Shell', 'flash', ({ instance }) => flashWindow(instance));
    bus.on('Shell', 'status', ({ text }) => setStatus(text));
    bus.on('Shell', 'windows-request', () => announce());
    bus.on('Shell', 'reload', () => location.reload());
    bus.on('Shell', 'factory-reset', () => {
      graph.clearStorage();
      location.reload();
    });
    bus.on('Shell', 'close-all', () => closeAll());
    bus.on('Shell', 'tile-all', () => tileWindows());
    bus.on('Shell', 'cascade-all', () => cascadeWindows());
    bus.on('Shell', 'theme', ({ mode, wallpaper, url }) => {
      if (url) {
        const node = graph.store.node('svc:theme');
        if (node) graph.commit({ label: 'wallpaper url', upsertNodes: { 'svc:theme': Object.assign({}, node, { wallpaperUrl: url }) } });
        return;
      }
      kernel.setTheme(mode, wallpaper);
    });
    bus.on('Shell', 'wallpaper', ({ index, url }) => {
      if (url) {
        const node = graph.store.node('svc:theme');
        if (node) graph.commit({ label: 'wallpaper url', upsertNodes: { 'svc:theme': Object.assign({}, node, { wallpaperUrl: url }) } });
        return;
      }
      if (typeof index === 'number') kernel.setTheme(kernel.theme().mode, index);
    });
    bus.on('System', 'open-path', ({ path }) => kernel.openFile(path));
    bus.on('Floret', 'mapped', ({ count, path }) => setStatus('Floret mapped ' + count + ' items at ' + path));
    bus.on('Notepad', 'saved', ({ path }) => setStatus('saved ' + String(path).split('/').pop()));
    bus.on('Terminal', 'notice', ({ text }) => setStatus(text));
    bus.on('Kernel', 'graph:changed', (event) => {
      const shellNode = graph.store.node('svc:theme');
      if (shellNode) applyTheme();
      if (dom.trayLed && event && event.stats) {
        dom.trayLed.title = 'graph v' + event.version + ' · ' + event.stats.nodes + ' nodes · ' + event.stats.edges + ' edges';
      }
      queueReconcile();
    });
  }

  async function boot() {
    veil('loading app runtime…', 0.15);
    kitText = await fetchText('src/apps/app-kit.js');
    cssText = await fetchText('src/apps/app.css');
    veil('reaping orphaned processes…', 0.35);
    cleanupOrphanProcesses();
    veil('projecting graph…', 0.55);
    applyTheme();
    applyIconSettings();
    renderIcons();
    renderStartMenu();
    wireBus();

    window.addEventListener('resize', () => {
      wins.forEach((rec) => {
        if (rec.maximized) applyBounds(rec, { x: 0, y: 0, w: desktopRect().width, h: desktopRect().height });
      });
    });

    dom.desktop.addEventListener('contextmenu', (event) => {
      if (event.target.closest('.win')) return;
      event.preventDefault();
      showDesktopMenu(event.clientX, event.clientY);
    });
    dom.desktop.addEventListener('click', (event) => {
      if (event.target.closest('.win')) return;
      [...dom.icons.children].forEach((child) => child.classList.remove('selected'));
    });
    document.addEventListener('click', (event) => {
      if (!dom.ctx.contains(event.target)) hideContextMenu();
      if (!dom.startMenu.contains(event.target) && !dom.startBtn.contains(event.target)) toggleStartMenu(false);
    });
    dom.startBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleStartMenu();
    });
    document.addEventListener('keydown', handleHotkeys);
    document.getElementById('tray-theme').addEventListener('click', toggleTheme);
    document.getElementById('tray-wallpaper').addEventListener('click', () => cycleWallpaper(1));
    document.getElementById('tray-graph').addEventListener('click', () => openApp('inspector'));
    document.getElementById('tray-clock').addEventListener('click', () => openApp('taskmanager'));

    setInterval(tickClock, 1000);
    tickClock();

    veil('restoring session…', 0.75);
    const savedSession = readTaskbarTabs();
    const windowNodes = graph.store.ofType('window').sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0));

    let restoredAny = false;

    if (savedSession && Array.isArray(savedSession.tabs) && savedSession.tabs.length > 0) {
      for (const tab of savedSession.tabs) {
        if (!tab.appId || !appMeta(tab.appId).uri) continue;
        await openApp(tab.appId, {
          instance: tab.instance,
          bounds: tab.bounds,
          file: tab.file || null,
          title: tab.title || null,
          minimized: !!tab.minimized,
          maximized: !!tab.maximized,
          docked: tab.docked || null,
          reuse: false,
        });
        restoredAny = true;
      }
      if (savedSession.focused && wins.has(savedSession.focused)) {
        focusWindow(savedSession.focused);
      }
    } else if (windowNodes.length) {
      for (const node of windowNodes) {
        if (!node.appId || !appMeta(node.appId).uri) continue;
        await openApp(node.appId, {
          instance: node.instance,
          bounds: { x: node.x, y: node.y, w: node.w, h: node.h },
          file: node.file || null,
          title: node.title || null,
          minimized: !!node.minimized,
          maximized: !!node.maximized,
          docked: node.docked || null,
          reuse: false,
        });
        restoredAny = true;
      }
    }

    if (!restoredAny) openApp((state.defaults && state.defaults.bootApp) || 'floret');
    if (dom.trayLed) dom.trayLed.title = 'kernel online';

    veil('ready', 1);
    setTimeout(() => dom.veil.classList.add('done'), 320);
    booted = true;
    announce();
    bus.emit('Shell', 'ready', { windows: allWindows(), fs: kernel.fs.kind, graph: graph.store.stats() });
  }

  return {
    boot,
    openApp,
    closeWindow,
    focusWindow,
    minimizeWindow,
    toggleMaximize,
    dockWindow,
    setStatus,
    setWindowTitle,
    tileWindows,
    cascadeWindows,
    closeAll,
    applyTheme,
    allWindows,
    announce,
    wins,
  };
}
