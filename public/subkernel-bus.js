/**
 * Bliss_26 Subkernel Bus
 * ----------------------
 * One nervous system for every surface: desktop shell, iframe apps, and
 * native Tauri windows all speak the same frames.
 *
 * Transport, in priority order:
 *   1. Tauri event `bliss26:bus`  — crosses native window boundaries
 *   2. postMessage up/down        — crosses iframe boundaries
 *   3. BroadcastChannel           — crosses browser tabs in dev
 *   4. Local EventTarget          — same document
 *
 * Every frame is stamped with an origin id and a monotonic seq so the
 * relay can drop echoes instead of looping forever.
 */
(() => {
  if (window.subkernel && window.subkernel.__bliss) return;

  const ORIGIN =
    (window.crypto?.randomUUID?.() || `o${Date.now()}${Math.random()}`).slice(0, 12);

  const tauriCore = () =>
    window.__TAURI__?.core || window.parent?.__TAURI__?.core || null;
  const tauriEvent = () =>
    window.__TAURI__?.event || window.parent?.__TAURI__?.event || null;

  class SubkernelBus extends EventTarget {
    constructor() {
      super();
      this.__bliss = true;
      this.origin = ORIGIN;
      this.seq = 0;
      this.seen = new Set();
      this.state = this._loadState();
      this._wireTauri();
      this._wirePostMessage();
      this._wireBroadcastChannel();
      this._wireStateReplay();
    }

    // ── state (persisted, shared) ──────────────────────────────────

    _loadState() {
      try {
        return JSON.parse(localStorage.getItem('bliss26_state') || '{}');
      } catch {
        return {};
      }
    }

    _saveState() {
      try {
        localStorage.setItem('bliss26_state', JSON.stringify(this.state));
      } catch {}
    }

    /** Set a shared key and broadcast the change to every surface. */
    setState(key, value) {
      this.state[key] = value;
      this._saveState();
      this.emit('System', 'state-change', { key, value });
      return value;
    }

    getState(key, fallback = null) {
      return key in this.state ? this.state[key] : fallback;
    }

    _wireStateReplay() {
      // Any surface that boots late asks for the current state; whoever
      // hears it answers with a full snapshot.
      this.on('System', 'state-request', () => {
        this.emit('System', 'state-snapshot', { state: this.state });
      });
      this.on('System', 'state-snapshot', ({ state }) => {
        if (!state) return;
        Object.assign(this.state, state);
        this._saveState();
        this.dispatchEvent(new CustomEvent('System:state-hydrated', { detail: this.state }));
      });
      this.on('System', 'state-change', ({ key, value }) => {
        this.state[key] = value;
        this._saveState();
      });
    }

    // ── frame plumbing ─────────────────────────────────────────────

    _frame(app, action, payload) {
      return {
        __bliss26: true,
        id: `${ORIGIN}:${++this.seq}`,
        origin: ORIGIN,
        app,
        action,
        payload,
        ts: Date.now(),
      };
    }

    _isEcho(frame) {
      if (!frame || !frame.__bliss26 || !frame.id) return true;
      if (this.seen.has(frame.id)) return true;
      this.seen.add(frame.id);
      if (this.seen.size > 500) {
        this.seen = new Set(Array.from(this.seen).slice(-200));
      }
      return false;
    }

    /** Deliver a frame to local listeners only. */
    _deliver(frame) {
      this.dispatchEvent(
        new CustomEvent(`${frame.app}:${frame.action}`, { detail: frame.payload })
      );
      this.dispatchEvent(new CustomEvent('*', { detail: frame }));
    }

    /** Receive from any transport: dedupe, deliver, re-propagate. */
    ingest(frame, from) {
      if (this._isEcho(frame)) return;
      this._deliver(frame);
      this._propagate(frame, from);
    }

    /** Push a frame outward on every transport except the one it came in on. */
    _propagate(frame, skip) {
      const core = tauriCore();
      if (core && skip !== 'tauri') {
        core.invoke('bus_broadcast', { frame }).catch(() => {});
      }
      if (skip !== 'parent' && window.parent && window.parent !== window) {
        try { window.parent.postMessage(frame, '*'); } catch {}
      }
      if (skip !== 'children') {
        for (const f of document.querySelectorAll('iframe')) {
          try { f.contentWindow?.postMessage(frame, '*'); } catch {}
        }
      }
      if (this.channel && skip !== 'channel') {
        try { this.channel.postMessage(frame); } catch {}
      }
    }

    // ── public API ─────────────────────────────────────────────────

    /** Fire an action at an app (or 'System' for everyone). */
    emit(app, action, payload = {}) {
      const frame = this._frame(app, action, payload);
      this.seen.add(frame.id);
      this._deliver(frame);
      this._propagate(frame, null);
      return frame.id;
    }

    /** Subscribe. Returns an unsubscribe function. */
    on(app, action, callback) {
      const key = `${app}:${action}`;
      const handler = (e) => callback(e.detail, e);
      this.addEventListener(key, handler);
      return () => this.removeEventListener(key, handler);
    }

    /** Subscribe to every frame that crosses the bus (for Task Manager). */
    onAny(callback) {
      const handler = (e) => callback(e.detail);
      this.addEventListener('*', handler);
      return () => this.removeEventListener('*', handler);
    }

    /** Emit and await a matching reply action. */
    request(app, action, payload = {}, replyAction = null, timeout = 4000) {
      const reply = replyAction || `${action}:reply`;
      return new Promise((resolve, reject) => {
        const off = this.on(app, reply, (data) => {
          clearTimeout(timer);
          off();
          resolve(data);
        });
        const timer = setTimeout(() => {
          off();
          reject(new Error(`bus request timeout: ${app}:${action}`));
        }, timeout);
        this.emit(app, action, payload);
      });
    }

    /** Direct kernel invoke with a clear error when not under Tauri. */
    async invoke(cmd, args = {}) {
      const core = tauriCore();
      if (!core) throw new Error(`kernel unavailable (${cmd}) — not running under Tauri`);
      return core.invoke(cmd, args);
    }

    get hasKernel() {
      return !!tauriCore();
    }

    // ── transports ─────────────────────────────────────────────────

    _wireTauri() {
      const ev = tauriEvent();
      if (!ev?.listen) return;
      ev.listen('bliss26:bus', (e) => this.ingest(e.payload, 'tauri')).catch(() => {});
    }

    _wirePostMessage() {
      window.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || !d.__bliss26) return;
        const from = e.source === window.parent ? 'parent' : 'children';
        this.ingest(d, from);
      });
    }

    _wireBroadcastChannel() {
      if (typeof BroadcastChannel === 'undefined') return;
      try {
        this.channel = new BroadcastChannel('bliss26-subkernel');
        this.channel.onmessage = (e) => this.ingest(e.data, 'channel');
      } catch {}
    }
  }

  window.subkernel = new SubkernelBus();

  // Ask whoever is already alive for the current shared state.
  window.subkernel.emit('System', 'state-request', {});

  // ── universal system handlers every surface honours ──────────────

  window.subkernel.on('System', 'theme-change', ({ theme }) => {
    if (!theme) return;
    document.documentElement.setAttribute('data-theme', theme);
    document.body?.setAttribute('data-theme', theme);
  });

  window.subkernel.on('System', 'accent-change', ({ color }) => {
    if (!color) return;
    document.documentElement.style.setProperty('--accent-color', color);
    document.documentElement.style.setProperty('--win-select', color);
  });

  window.subkernel.on('System', 'font-scale', ({ scale }) => {
    if (!scale) return;
    document.documentElement.style.fontSize = `${scale}%`;
  });

  window.subkernel.on('System', 'reload-all', () => location.reload());

  // Apply persisted appearance immediately on boot.
  const st = window.subkernel.state;
  if (st.theme) document.documentElement.setAttribute('data-theme', st.theme);
  if (st.accent) document.documentElement.style.setProperty('--accent-color', st.accent);
  if (st.fontScale) document.documentElement.style.fontSize = `${st.fontScale}%`;
})();
