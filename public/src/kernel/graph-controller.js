'use strict';

import { OSGraphStore, clone } from './graph.js';

const STORAGE_KEY = 'cloudos.graph.v1';
const SNAPSHOT_KEY = 'cloudos.graph.snapshots.v1';
const HISTORY_LIMIT = 200;
const COALESCE_MS = 900;

export class OSGraphController {
  constructor({ store, bus = null, storage = globalThis.localStorage, storageKey = STORAGE_KEY, snapshotKey = SNAPSHOT_KEY } = {}) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.snapshotKey = snapshotKey;
    this.bus = bus;
    this.entries = [{ store: store || new OSGraphStore(), label: 'init', at: Date.now(), action: 'init', coalesceKey: null }];
    this.cursor = 0;
    this.subscribers = new Set();
    this.saveTimer = null;
    this.persist = true;
    this.handleStorage = this.handleStorage.bind(this);
  }

  get store() {
    return this.entries[this.cursor].store;
  }
  get canUndo() {
    return this.cursor > 0;
  }
  get canRedo() {
    return this.cursor < this.entries.length - 1;
  }
  get history() {
    return this.entries.map((entry, index) => ({
      index,
      label: entry.label,
      action: entry.action,
      at: entry.at,
      version: entry.store.version,
      nodes: entry.store.size,
      current: index === this.cursor,
    }));
  }

  commit(tx) {
    const next = this.store.commit(tx);
    const label = tx.label || 'commit';

    if (tx.coalesceKey && this.cursor === this.entries.length - 1) {
      const prev = this.entries[this.cursor];
      if (prev.coalesceKey === tx.coalesceKey && Date.now() - prev.at < COALESCE_MS) {
        this.entries[this.cursor] = { store: next, label, at: Date.now(), action: 'commit', coalesceKey: tx.coalesceKey };
        this.publish('commit', tx);
        return next;
      }
    }

    this.entries.length = this.cursor + 1;
    this.entries.push({ store: next, label, at: Date.now(), action: 'commit', coalesceKey: tx.coalesceKey || null });
    while (this.entries.length > HISTORY_LIMIT) this.entries.shift();
    this.cursor = this.entries.length - 1;
    this.publish('commit', tx);
    return next;
  }

  undo() {
    if (!this.canUndo) return this.store;
    this.cursor -= 1;
    this.publish('undo');
    return this.store;
  }

  redo() {
    if (!this.canRedo) return this.store;
    this.cursor += 1;
    this.publish('redo');
    return this.store;
  }

  jumpTo(index) {
    const target = Math.max(0, Math.min(this.entries.length - 1, index | 0));
    if (target === this.cursor) return this.store;
    this.cursor = target;
    this.publish('jump');
    return this.store;
  }

  replaceStore(store, { label = 'replace', action = 'replace', keepHistory = false } = {}) {
    if (keepHistory) {
      this.entries.length = this.cursor + 1;
      this.entries.push({ store, label, at: Date.now(), action, coalesceKey: null });
      while (this.entries.length > HISTORY_LIMIT) this.entries.shift();
      this.cursor = this.entries.length - 1;
    } else {
      this.entries = [{ store, label, at: Date.now(), action, coalesceKey: null }];
      this.cursor = 0;
    }
    this.publish(action);
    return store;
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  publish(action, tx = null) {
    const event = {
      action,
      tx: tx ? { label: tx.label || null, coalesceKey: tx.coalesceKey || null } : null,
      label: this.entries[this.cursor].label,
      version: this.store.version,
      at: Date.now(),
      graph: this.store.toJSON(),
      stats: this.store.stats(),
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      historyIndex: this.cursor,
      historyLength: this.entries.length,
    };
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch (error) {
        console.error('[Graph] subscriber failed', error);
      }
    }
    if (this.bus) this.bus.emit('Kernel', 'graph:changed', event);
    this.scheduleSave();
    return event;
  }

  toJSON() {
    return this.store.toJSON();
  }

  scheduleSave() {
    if (!this.persist || !this.storage) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 150);
  }

  save() {
    if (!this.persist || !this.storage) return false;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify({ savedAt: Date.now(), graph: this.toJSON() }));
      return true;
    } catch (error) {
      console.error('[Graph] persistence failed', error);
      return false;
    }
  }

  load() {
    if (!this.storage) return false;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      const store = OSGraphStore.fromJSON(parsed.graph || parsed);
      this.entries = [{ store, label: 'restored', at: Date.now(), action: 'load', coalesceKey: null }];
      this.cursor = 0;
      this.publish('load');
      return true;
    } catch (error) {
      console.error('[Graph] load failed', error);
      return false;
    }
  }

  clearStorage() {
    try {
      this.storage.removeItem(this.storageKey);
    } catch (error) {
      console.error('[Graph] clear failed', error);
    }
  }

  listSnapshots() {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(this.snapshotKey);
      const list = raw ? JSON.parse(raw) : [];
      return list.map((item) => ({ name: item.name, at: item.at, version: item.graph.version, nodes: Object.keys(item.graph.nodes).length }));
    } catch (error) {
      return [];
    }
  }

  snapshot(name) {
    if (!this.storage) return null;
    const list = this.readSnapshots();
    const entry = { name: String(name || 'snapshot'), at: Date.now(), graph: this.toJSON() };
    const existing = list.findIndex((item) => item.name === entry.name);
    if (existing >= 0) list[existing] = entry;
    else list.push(entry);
    while (list.length > 12) list.shift();
    this.storage.setItem(this.snapshotKey, JSON.stringify(list));
    return entry;
  }

  restoreSnapshot(name) {
    const entry = this.readSnapshots().find((item) => item.name === name);
    if (!entry) return false;
    this.replaceStore(OSGraphStore.fromJSON(entry.graph), { label: `restore ${name}`, action: 'restore' });
    return true;
  }

  deleteSnapshot(name) {
    const list = this.readSnapshots().filter((item) => item.name !== name);
    this.storage.setItem(this.snapshotKey, JSON.stringify(list));
    return true;
  }

  readSnapshots() {
    try {
      const raw = this.storage.getItem(this.snapshotKey);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      return [];
    }
  }

  importJSON(text, label = 'import') {
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    this.replaceStore(OSGraphStore.fromJSON(parsed.graph || parsed), { label, action: 'import' });
    return true;
  }

  exportJSON() {
    return JSON.stringify({ exportedAt: new Date().toISOString(), ...this.toJSON() }, null, 2);
  }

  handleStorage(event) {
    if (event.key !== this.storageKey || !event.newValue || !this.persist) return;
    try {
      const parsed = JSON.parse(event.newValue);
      const remote = OSGraphStore.fromJSON(parsed.graph || parsed);
      if (remote.version >= this.store.version) this.replaceStore(remote, { label: 'cross-tab sync', action: 'sync' });
    } catch (error) {
      console.error('[Graph] cross-tab sync failed', error);
    }
  }

  bind(bus = this.bus) {
    if (!bus) return () => {};
    this.bus = bus;

    const offs = [
      bus.handle('Kernel', 'graph:commit', ({ tx } = {}) => {
        const store = this.commit(tx || {});
        return { ok: true, version: store.version, stats: store.stats() };
      }),
      bus.handle('Kernel', 'graph:query', () => this.toJSON()),
      bus.handle('Kernel', 'graph:stats', () => this.store.stats()),
      bus.handle('Kernel', 'graph:history', () => ({ entries: this.history, canUndo: this.canUndo, canRedo: this.canRedo })),
      bus.handle('Kernel', 'graph:undo', () => ({ ok: true, version: this.undo().version, canUndo: this.canUndo, canRedo: this.canRedo })),
      bus.handle('Kernel', 'graph:redo', () => ({ ok: true, version: this.redo().version, canUndo: this.canUndo, canRedo: this.canRedo })),
      bus.handle('Kernel', 'graph:jump', ({ index } = {}) => ({ ok: true, version: this.jumpTo(index).version, historyIndex: this.cursor })),
      bus.handle('Kernel', 'graph:replace', ({ graph, label } = {}) => {
        this.replaceStore(OSGraphStore.fromJSON(graph), { label: label || 'replace', action: 'replace', keepHistory: true });
        return { ok: true, version: this.store.version };
      }),
      bus.handle('Kernel', 'graph:snapshot', ({ name } = {}) => {
        const entry = this.snapshot(name);
        return { ok: !!entry, name: entry ? entry.name : null, snapshots: this.listSnapshots() };
      }),
      bus.handle('Kernel', 'graph:snapshots', () => ({ snapshots: this.listSnapshots() })),
      bus.handle('Kernel', 'graph:restore-snapshot', ({ name } = {}) => ({ ok: this.restoreSnapshot(name) })),
      bus.handle('Kernel', 'graph:delete-snapshot', ({ name } = {}) => ({ ok: this.deleteSnapshot(name), snapshots: this.listSnapshots() })),
      bus.handle('Kernel', 'graph:export', () => ({ json: this.exportJSON() })),
      bus.handle('Kernel', 'graph:import', ({ json, label } = {}) => {
        this.importJSON(json, label || 'import');
        return { ok: true, version: this.store.version, stats: this.store.stats() };
      }),
      bus.handle('Kernel', 'graph:reset', ({ graph } = {}) => {
        if (graph) this.replaceStore(OSGraphStore.fromJSON(graph), { label: 'reset', action: 'reset' });
        return { ok: true };
      }),
      bus.handle('Kernel', 'graph:node', ({ id } = {}) => (id ? { node: this.store.node(id), edges: this.store.edgesFrom(id).concat(this.store.edgesTo(id)) } : { node: null })),
      bus.handle('Kernel', 'graph:patch-node', ({ id, patch } = {}) => {
        const node = this.store.node(id);
        if (!node) return { ok: false, error: 'missing node ' + id };
        this.commit({ label: `patch ${id}`, upsertNodes: { [id]: { ...clone(node), ...patch } } });
        return { ok: true };
      }),
    ];

    globalThis.addEventListener('storage', this.handleStorage);

    return () => {
      offs.forEach((off) => off && off());
      globalThis.removeEventListener('storage', this.handleStorage);
    };
  }
}
