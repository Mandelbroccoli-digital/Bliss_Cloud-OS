'use strict';

export function normalizePath(path) {
  const parts = String(path == null ? '/' : path)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.');
  const out = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export function joinPath(base, name) {
  return normalizePath(String(base || '/') + '/' + String(name || ''));
}

export function basename(path) {
  const clean = normalizePath(path);
  if (clean === '/') return '/';
  return clean.slice(clean.lastIndexOf('/') + 1);
}

export function dirname(path) {
  const clean = normalizePath(path);
  if (clean === '/') return '/';
  return clean.slice(0, clean.lastIndexOf('/')) || '/';
}

export function segments(path) {
  return normalizePath(path).split('/').filter(Boolean);
}

export function extname(name) {
  const base = String(name || '');
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

const ICON_EXT_IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const ICON_EXT_AUDIO = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];
const ICON_EXT_VIDEO = ['mp4', 'webm', 'mkv', 'mov'];

export function fileIcon(name, kind) {
  if (kind === 'dir') return '📁';
  const ext = extname(name);
  if (ICON_EXT_IMAGE.includes(ext)) return '🖼️';
  if (ICON_EXT_AUDIO.includes(ext)) return '🎵';
  if (ICON_EXT_VIDEO.includes(ext)) return '🎬';
  if (['html', 'htm'].includes(ext)) return '🌐';
  if (['js', 'mjs', 'ts', 'json'].includes(ext)) return '📜';
  if (['md', 'txt'].includes(ext)) return '📝';
  if (['zip', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['gguf', 'safetensors', 'bin', 'wasm'].includes(ext)) return '🧩';
  return '📄';
}

function createMemoryBackend() {
  const dirs = new Set(['/']);
  const files = new Map();

  return {
    kind: 'memory',
    async list(path) {
      const clean = normalizePath(path);
      const out = [];
      for (const dir of dirs) {
        if (dir === clean || dirname(dir) !== clean) continue;
        out.push({ name: basename(dir), kind: 'dir', size: 0, mtime: 0 });
      }
      for (const [file, entry] of files) {
        if (dirname(file) !== clean) continue;
        out.push({ name: basename(file), kind: 'file', size: entry.size, mtime: entry.mtime });
      }
      return out;
    },
    async stat(path) {
      const clean = normalizePath(path);
      if (dirs.has(clean)) return { kind: 'dir', size: 0, mtime: 0 };
      const entry = files.get(clean);
      if (entry) return { kind: 'file', size: entry.size, mtime: entry.mtime };
      return null;
    },
    async mkdir(path) {
      dirs.add(normalizePath(path));
    },
    async readBytes(path) {
      const entry = files.get(normalizePath(path));
      if (!entry) throw new Error('ENOENT: ' + path);
      return entry.data.slice();
    },
    async writeBytes(path, bytes) {
      const clean = normalizePath(path);
      dirs.add(dirname(clean));
      files.set(clean, { data: bytes.slice(), size: bytes.length, mtime: Date.now() });
    },
    async remove(path, { recursive = false } = {}) {
      const clean = normalizePath(path);
      if (dirs.has(clean) && clean !== '/') {
        const children = [...dirs].filter((d) => d !== clean && d.startsWith(clean + '/'));
        const nested = [...files.keys()].filter((f) => f.startsWith(clean + '/'));
        if (!recursive && (children.length || nested.length)) throw new Error('ENOTEMPTY: ' + clean);
        children.forEach((d) => dirs.delete(d));
        nested.forEach((f) => files.delete(f));
        dirs.delete(clean);
        return true;
      }
      if (files.delete(clean)) return true;
      throw new Error('ENOENT: ' + clean);
    },
  };
}

function createOpfsBackend(rootHandle) {
  async function dirHandle(path, { create = false } = {}) {
    let handle = rootHandle;
    for (const part of segments(path)) handle = await handle.getDirectoryHandle(part, { create });
    return handle;
  }
  async function entryHandle(path) {
    const parent = await dirHandle(dirname(path));
    const name = basename(path);
    try {
      return { kind: 'dir', handle: await parent.getDirectoryHandle(name) };
    } catch (error) {
      return { kind: 'file', handle: await parent.getFileHandle(name) };
    }
  }

  return {
    kind: 'opfs',
    async list(path) {
      const handle = await dirHandle(path);
      const out = [];
      for await (const [name, child] of handle.entries()) {
        if (child.kind === 'directory') {
          out.push({ name, kind: 'dir', size: 0, mtime: 0 });
        } else {
          const file = await child.getFile();
          out.push({ name, kind: 'file', size: file.size, mtime: file.lastModified });
        }
      }
      return out;
    },
    async stat(path) {
      if (normalizePath(path) === '/') return { kind: 'dir', size: 0, mtime: 0 };
      try {
        const entry = await entryHandle(path);
        if (entry.kind === 'dir') return { kind: 'dir', size: 0, mtime: 0 };
        const file = await entry.handle.getFile();
        return { kind: 'file', size: file.size, mtime: file.lastModified };
      } catch (error) {
        return null;
      }
    },
    async mkdir(path) {
      await dirHandle(path, { create: true });
    },
    async readBytes(path) {
      const parent = await dirHandle(dirname(path));
      const handle = await parent.getFileHandle(basename(path));
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    },
    async writeBytes(path, bytes) {
      const parent = await dirHandle(dirname(path), { create: true });
      const handle = await parent.getFileHandle(basename(path), { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
    },
    async remove(path, { recursive = false } = {}) {
      const parent = await dirHandle(dirname(path));
      await parent.removeEntry(basename(path), { recursive });
      return true;
    },
  };
}

const DEFAULT_POLICY = { read: ['/'], write: ['/home'] };

function pathAllowed(roots, path) {
  const clean = normalizePath(path);
  return roots.some((root) => {
    const base = normalizePath(root);
    return base === '/' || clean === base || clean.startsWith(base + '/');
  });
}

export async function createFileSystem({ bus = null, seedTree = null, policies = {}, app = 'kernel' } = {}) {
  let backend = null;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
      backend = createOpfsBackend(await navigator.storage.getDirectory());
    }
  } catch (error) {
    console.warn('[FS] OPFS unavailable — falling back to in-memory filesystem', error);
  }
  if (!backend) backend = createMemoryBackend();

  const policyMap = new Map(Object.entries(policies));

  function policyFor(appId) {
    return policyMap.get(appId) || DEFAULT_POLICY;
  }

  function check(appId, op, path) {
    const policy = policyFor(appId);
    const roots = op === 'read' ? policy.read : policy.write;
    if (!pathAllowed(roots, path)) {
      throw new Error(`EPERM: ${appId || 'unknown'} may not ${op} ${normalizePath(path)}`);
    }
  }

  const api = {
    kind: backend.kind,
    normalize: normalizePath,
    join: joinPath,
    dirname,
    basename,
    extname,

    async list(path = '/') {
      const clean = normalizePath(path);
      const entries = await backend.list(clean).catch(() => []);
      return entries
        .map((entry) => ({ ...entry, path: joinPath(clean, entry.name), icon: fileIcon(entry.name, entry.kind) }))
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
    },

    async stat(path) {
      return backend.stat(path);
    },

    async exists(path) {
      return !!(await backend.stat(path));
    },

    async isDir(path) {
      const info = await backend.stat(path);
      return !!info && info.kind === 'dir';
    },

    async mkdir(path) {
      const clean = normalizePath(path);
      await backend.mkdir(clean);
      if (bus) bus.emit('Kernel', 'fs:changed', { action: 'mkdir', path: clean });
      return clean;
    },

    async readText(path) {
      const bytes = await backend.readBytes(path);
      return new TextDecoder().decode(bytes);
    },

    async readBytes(path) {
      return backend.readBytes(path);
    },

    async readJSON(path) {
      return JSON.parse(await api.readText(path));
    },

    async writeText(path, text) {
      return api.writeBytes(path, new TextEncoder().encode(String(text)));
    },

    async writeBytes(path, bytes) {
      const clean = normalizePath(path);
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      await backend.writeBytes(clean, data);
      if (bus) bus.emit('Kernel', 'fs:changed', { action: 'write', path: clean, size: data.length });
      return { path: clean, size: data.length };
    },

    async writeJSON(path, value) {
      return api.writeText(path, JSON.stringify(value, null, 2));
    },

    async remove(path, { recursive = true } = {}) {
      const clean = normalizePath(path);
      await backend.remove(clean, { recursive });
      if (bus) bus.emit('Kernel', 'fs:changed', { action: 'remove', path: clean });
      return clean;
    },

    async walk(path = '/', { maxDepth = 6, dirsOnly = false } = {}) {
      const out = [];
      const stack = [{ path: normalizePath(path), depth: 0 }];
      while (stack.length) {
        const current = stack.shift();
        for (const entry of await api.list(current.path)) {
          out.push({ ...entry, depth: current.depth });
          if (entry.kind === 'dir' && current.depth + 1 < maxDepth) stack.push({ path: entry.path, depth: current.depth + 1 });
        }
      }
      return dirsOnly ? out.filter((entry) => entry.kind === 'dir') : out;
    },

    setPolicy(appId, policy) {
      policyMap.set(appId, { ...DEFAULT_POLICY, ...policy });
      return policyMap.get(appId);
    },

    getPolicy(appId) {
      return policyFor(appId);
    },

    scoped(appId) {
      const guard = (op, path) => {
        check(appId, op, path);
        return path;
      };
      return {
        app: appId,
        kind: backend.kind,
        policy: policyFor(appId),
        list: (path = '/') => api.list(guard('read', path)),
        stat: (path) => api.stat(guard('read', path)),
        exists: (path) => api.exists(guard('read', path)),
        isDir: (path) => api.isDir(guard('read', path)),
        readText: (path) => api.readText(guard('read', path)),
        readBytes: (path) => api.readBytes(guard('read', path)),
        readJSON: (path) => api.readJSON(guard('read', path)),
        writeText: (path, text) => api.writeText(guard('write', path), text),
        writeBytes: (path, bytes) => api.writeBytes(guard('write', path), bytes),
        writeJSON: (path, value) => api.writeJSON(guard('write', path), value),
        mkdir: (path) => api.mkdir(guard('write', path)),
        remove: (path) => api.remove(guard('write', path)),
        walk: (path = '/', opts) => api.walk(guard('read', path), opts),
        join: joinPath,
        dirname,
        basename,
        extname,
      };
    },

    async estimate() {
      try {
        const result = await navigator.storage.estimate();
        return { usage: result.usage || 0, quota: result.quota || 0 };
      } catch (error) {
        return { usage: 0, quota: 0 };
      }
    },
  };

  if (seedTree) await seedMissing(api, seedTree);

  return api;
}

async function seedMissing(api, tree, base = '/') {
  for (const [name, value] of Object.entries(tree)) {
    const path = joinPath(base, name);
    if (value && typeof value === 'object') {
      if (!(await api.exists(path))) await api.mkdir(path).catch(() => {});
      await seedMissing(api, value, path);
    } else if (!(await api.exists(path))) {
      await api.writeText(path, String(value)).catch(() => {});
    }
  }
}
