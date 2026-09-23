'use strict';

import { createBus } from './bus.js';
import { OSGraphStore, createId, edgeId } from './graph.js';
import { OSGraphController } from './graph-controller.js';
import { createFileSystem, normalizePath, joinPath, basename, dirname, extname } from './fs.js';
import { APPS, NODE_STYLE, EDGE_STYLE, appMeta, resolveApp, DESKTOP_ORDER } from './registry.js';

export const NODE_ID = {
  dir: (path) => 'dir:' + normalizePath(path),
  file: (path) => 'file:' + normalizePath(path),
  app: (id) => 'app:' + id,
  window: (id) => 'win:' + id,
  process: (id) => 'proc:' + id,
};

const WALLPAPERS = [
  { name: 'Bliss (procedural)', css: 'linear-gradient(165deg, #2f6fd0 0%, #5b8fe0 30%, #8fc45a 62%, #3f7a2a 100%)' },
  { name: 'Obsidian', css: 'linear-gradient(135deg, #060a10 0%, #0f172a 55%, #1e1b4b 100%)' },
  { name: 'Deep Field', css: 'radial-gradient(circle at 22% 30%, #1e3a8a 0%, #0b1120 55%, #020617 100%)' },
  { name: 'Violet Static', css: 'linear-gradient(135deg, #2e1065 0%, #4c1d95 40%, #0f172a 100%)' },
  { name: 'Terminal Green', css: 'radial-gradient(circle at 80% 15%, #064e3b 0%, #04241b 55%, #010a08 100%)' },
  {
    name: 'Bliss (photo)',
    url: 'https://user.uploads.dev/file/29f2bd6a7b7169597882c2814631cb95.jpg',
    css: "url('https://user.uploads.dev/file/29f2bd6a7b7169597882c2814631cb95.jpg') center/cover",
  },
];

const SEED_TREE = {
  home: {
    Desktop: {
      'welcome.md': `# Welcome to CloudOS

CloudOS has no folders of programs and no registry of windows.
There is exactly one thing: a **typed property graph**.

Every object on this machine — a file, a directory, an app, a process,
a window, a service — is a node in that graph, and every relationship
between them is an edge.

The desktop you are looking at is not the truth. It is a *projection*
of the graph, drawn for humans. Floret is another projection. The task
manager is a third. Delete them all and the graph is unchanged.

Try this:
  1. Open Floret and find this file: it is a node with an \`opens\` edge
     pointing at the Notepad process that is rendering it.
  2. Drag a node. That commits a \`layout\` transaction — undo it with
     Ctrl+Z and watch the node return.
  3. Open the Graph Store app and watch the transaction log while you
     move windows around. Every window you move is a commit.
`,
      'todo.md': `# Roadmap

- [x] canonical graph store (typed nodes, atomic commits)
- [x] transaction history, undo/redo, time travel
- [x] real filesystem (OPFS) indexed into the graph lazily
- [x] projections: desktop, Floret, task manager, inspector
- [ ] presence + collaborative cursors over the server plugin
- [ ] agent nodes with capability manifests
- [ ] graph diffs instead of full-graph broadcasts
`,
    },
    Documents: {
      'cloud-os-manifesto.md': `# The nodegraph operating system

An operating system is usually a pile of special cases: the window
manager knows about windows, the file manager knows about files, the
task manager knows about processes, and none of them agree on anything.

CloudOS is an attempt to collapse that pile into one structure.

## One structure

A node has an id, a type, and properties. An edge has a source, a
target, and a kind. That is the whole schema. \`app\`, \`window\`,
\`file\`, \`dir\`, \`process\`, \`agent\` and \`service\` are just the set of
types we happen to ship with.

## Transactions, not mutations

Nothing edits the graph in place. You submit a transaction — a batch of
node and edge upserts and deletes — and the store validates the whole
thing, then returns a *new* graph. Because old graphs are still around,
undo, redo, time travel, snapshots and cross-tab sync all fall out for
free instead of being features you have to build.

## Projections, not owners

Floret does not own a directory tree. The taskbar does not own a
window list. They read the graph and draw it. When a projection wants
to change something it sends a command back to the kernel and the
kernel decides whether to commit it. That is the permission boundary.

## Consequences

- Killing a window is deleting a node. Undo brings it back.
- Opening a file is adding an \`opens\` edge. The file's "recent" list is
  just a query on edges.
- Moving a node is data, so layouts are durable and shareable.
`,
      'graph-model.md': `# Graph model (v1)

node types : app | window | file | dir | process | agent | service
edge kinds : contains | launches | opens | owns | communicates
             mounts | spawns | reads | writes

## Conventions

    app:<id>            a launchable application definition
    proc:<instance>     a running instance of an app
    win:<instance>      a window owned by a process
    dir:<abs path>      a directory in the mounted filesystem
    file:<abs path>     a file in the mounted filesystem
    svc:<name>          a kernel service
    sys:<name>          a kernel-owned process

    app  --launches-->  proc  --owns--> window --opens--> file
    shell --contains--> window
    fs   --mounts-->    dir:/
    dir  --contains-->  dir | file

## Transactions

    { label, upsertNodes, deleteNodes, upsertEdges, deleteEdges, coalesceKey }

Deleting a node deletes its incident edges. Node types are immutable.
Edges are validated against the resulting node set, and the whole
transaction fails atomically if any part of it is invalid.
`,
      'sample.json': JSON.stringify(
        {
          generator: 'perchance',
          kernel: { version: 1, bus: 'addressable pub/sub + rpc', store: 'immutable' },
          nodeTypes: ['app', 'window', 'file', 'dir', 'process', 'agent', 'service'],
          edgeKinds: ['contains', 'launches', 'opens', 'owns', 'communicates', 'mounts', 'spawns', 'reads', 'writes'],
        },
        null,
        2
      ),
    },
    Projects: {
      'hello.js': `export function greet(name) {\n  return \`hello, \${name} — the graph is fine\`;\n}\n\nconsole.log(greet('world'));\n`,
      'florets.txt': Array.from({ length: 24 }, (_, i) => `${(i + 1).toString().padStart(2, '0')}  node-${(i * 7 + 3).toString(36)}  depth ${i % 5}`).join('\n') + '\n',
      'orbit.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320">
<defs><radialGradient id="g"><stop offset="0%" stop-color="#38bdf8"/><stop offset="100%" stop-color="#0f172a"/></radialGradient></defs>
<rect width="320" height="320" fill="#060a10"/>
<circle cx="160" cy="160" r="34" fill="url(#g)"/>
<g fill="none" stroke="#38bdf8" stroke-opacity="0.6">
<ellipse cx="160" cy="160" rx="120" ry="46"/><ellipse cx="160" cy="160" rx="120" ry="46" transform="rotate(60 160 160)"/>
<ellipse cx="160" cy="160" rx="120" ry="46" transform="rotate(120 160 160)"/>
</g>
<g fill="#fbbf24"><circle cx="280" cy="160" r="5"/><circle cx="100" cy="264" r="5"/><circle cx="100" cy="56" r="5"/></g>
</svg>
`,
    },
    Pictures: {
      'graph-paper.txt': 'Drop images in here — the Viewer app renders png/jpg/gif/webp/svg from the real filesystem.\n',
    },
  },
  system: {
    'kernel.json': JSON.stringify({ boot: 'src/kernel/kernel.js', shell: 'src/shell/shell.js', bus: 'src/kernel/bus.js', store: 'src/kernel/graph.js', fs: 'src/kernel/fs.js' }, null, 2),
    'boot.log': `[boot] perchance engine ready\n[boot] creating event bus\n[boot] restoring graph from local storage\n[boot] mounting OPFS\n[boot] seeding missing files\n[boot] graph ready\n`,
  },
  etc: {
    motd: 'CloudOS — one graph, many projections. Type `help` in the Terminal.\n',
  },
};

function buildInitialGraph(defaults) {
  const nodes = {};
  const edges = {};
  const add = (node) => {
    nodes[node.id] = node;
    return node;
  };
  const link = (from, to, kind) => {
    const id = edgeId(from, to, kind);
    edges[id] = { id, from, to, kind };
  };

  add({ id: 'sys:kernel', type: 'process', name: 'CloudOS Kernel', pid: 1, status: 'running', system: true, desc: 'Owns the graph store. Validates and commits every transaction.' });
  add({ id: 'sys:shell', type: 'process', name: 'Shell / Window Manager', pid: 2, status: 'running', system: true, desc: 'Projects window nodes onto the desktop.' });
  add({ id: 'svc:bus', type: 'service', name: 'Event Bus', desc: 'Addressable pub/sub with correlation-id RPC.' });
  add({ id: 'svc:graph', type: 'service', name: 'Graph Store', desc: 'Immutable typed property graph with atomic transactions.' });
  add({ id: 'svc:fs', type: 'service', name: 'OPFS Mount', desc: 'Origin Private File System, indexed into the graph lazily.' });
  add({
    id: 'svc:theme',
    type: 'service',
    name: 'Theme Service',
    mode: defaults && defaults.theme === 'xp' ? 'xp' : 'dark',
    wallpaper: defaults && defaults.wallpaper != null ? Number(defaults.wallpaper) || 0 : 1,
    desc: 'Theme + wallpaper. Consumed by every projection.',
  });
  add({ id: 'dir:/', type: 'dir', name: 'rootfs', path: '/', scanned: false, auto: true, mount: 'opfs' });

  link('sys:kernel', 'sys:shell', 'spawns');
  link('sys:kernel', 'svc:bus', 'owns');
  link('sys:kernel', 'svc:graph', 'owns');
  link('sys:kernel', 'svc:fs', 'owns');
  link('sys:kernel', 'svc:theme', 'owns');
  link('sys:shell', 'svc:bus', 'communicates');
  link('svc:fs', 'dir:/', 'mounts');

  for (const [id, meta] of Object.entries(APPS)) {
    add({ id: 'app:' + id, type: 'app', name: meta.title, icon: meta.icon, uri: meta.uri, kind: meta.kind, blurb: meta.blurb, source: 'registry' });
    link('sys:shell', 'app:' + id, 'contains');
  }

  return { version: 1, nodes, edges };
}

function pjsValue(node) {
  if (node == null) return undefined;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return node;
  try {
    if (typeof node.evaluateItem !== 'undefined') return node.evaluateItem;
  } catch (error) {
    /* pjs node not evaluable */
  }
  return undefined;
}

function readPjsDefaults() {
  try {
    const source = globalThis.root && globalThis.root.defaults;
    if (!source) return null;
    return {
      theme: pjsValue(source.theme),
      wallpaper: pjsValue(source.wallpaper),
      bootApp: pjsValue(source.bootApp),
    };
  } catch (error) {
    return null;
  }
}

export async function bootKernel({ seed = true } = {}) {
  const bus = createBus({ name: 'subkernel' });
  const graph = new OSGraphController({ bus });
  const fs = await createFileSystem({ bus, seedTree: seed ? SEED_TREE : null });
  const defaults = readPjsDefaults();

  const restored = graph.load();
  if (!restored) {
    graph.persist = false;
    graph.replaceStore(new OSGraphStore(buildInitialGraph(defaults)), { label: 'bootstrap' });
    graph.persist = true;
    graph.save();
  }

  const state = {
    bootedAt: Date.now(),
    restored,
    defaults,
    pid: 100,
    windows: [],
    focused: null,
    theme: 'dark',
    wallpaper: 1,
    fsKind: fs.kind,
    ready: false,
  };

  const instances = new Map();
  let instanceSeq = 0;

  function themeNode() {
    return graph.store.node('svc:theme');
  }

  function syncTheme() {
    const node = themeNode();
    if (node) {
      state.theme = node.mode === 'xp' ? 'xp' : 'dark';
      state.wallpaper = Number(node.wallpaper || 0);
    }
    return { mode: state.theme, wallpaper: state.wallpaper };
  }

  function ensureRegistryNodes() {
    const store = graph.store;
    const upsertNodes = {};
    const upsertEdges = {};
    const link = (from, to, kind) => {
      const id = edgeId(from, to, kind);
      if (!store.hasEdge(id)) upsertEdges[id] = { id, from, to, kind };
    };
    for (const [id, meta] of Object.entries(APPS)) {
      const nodeId = 'app:' + id;
      const existing = store.node(nodeId);
      if (!existing || existing.uri !== meta.uri) {
        upsertNodes[nodeId] = { id: nodeId, type: 'app', name: meta.title, icon: meta.icon, uri: meta.uri, kind: meta.kind, blurb: meta.blurb, source: 'registry' };
      }
      link('sys:shell', nodeId, 'contains');
    }
    const services = [
      { id: 'svc:theme', patch: { type: 'service', name: 'Theme Service', desc: 'Theme + wallpaper. Consumed by every projection.' } },
      { id: 'svc:ai', patch: { type: 'service', name: 'AI Service (Gemini)', desc: 'Kernel multimodal intelligence provider via /api/gemini.' } },
    ];
    for (const service of services) {
      if (!store.hasNode(service.id)) upsertNodes[service.id] = { id: service.id, ...service.patch, mode: 'dark', wallpaper: 1 };
      link('sys:kernel', service.id, 'owns');
    }
    if (!store.hasNode('agent:logos')) {
      upsertNodes['agent:logos'] = {
        id: 'agent:logos',
        type: 'agent',
        name: 'Logos',
        icon: '🦀',
        status: 'online',
        capabilities: ['fs:read', 'fs:write', 'graph:query', 'reasoning'],
        auto: true,
      };
      link('sys:kernel', 'agent:logos', 'owns');
      link('agent:logos', 'svc:bus', 'communicates');
      link('agent:logos', 'svc:ai', 'communicates');
    }
    if (!store.hasNode('dir:/')) {
      upsertNodes['dir:/'] = { id: 'dir:/', type: 'dir', name: 'rootfs', path: '/', scanned: false, auto: true, mount: 'opfs' };
      link('svc:fs', 'dir:/', 'mounts');
    }
    if (Object.keys(upsertNodes).length || Object.keys(upsertEdges).length) {
      graph.commit({ label: 'sync registry', upsertNodes, upsertEdges });
    }
  }

  async function scan(path, { prune = true } = {}) {
    const clean = normalizePath(path);
    const info = await fs.stat(clean);
    if (!info || info.kind !== 'dir') return { ok: false, error: 'not a directory: ' + clean };
    const entries = await fs.list(clean);
    const dirId = NODE_ID.dir(clean);
    const store = graph.store;
    const upsertNodes = {};
    const upsertEdges = {};
    const link = (from, to, kind) => {
      const id = edgeId(from, to, kind);
      upsertEdges[id] = { id, from, to, kind };
    };

    upsertNodes[dirId] = {
      id: dirId,
      type: 'dir',
      name: clean === '/' ? 'rootfs' : basename(clean),
      path: clean,
      auto: true,
      scanned: true,
      scannedAt: Date.now(),
      childCount: entries.length,
    };

    const seen = new Set();
    for (const entry of entries) {
      const nodeId = entry.kind === 'dir' ? NODE_ID.dir(entry.path) : NODE_ID.file(entry.path);
      seen.add(nodeId);
      const previous = store.node(nodeId);
      const node = {
        id: nodeId,
        type: entry.kind === 'dir' ? 'dir' : 'file',
        name: entry.name,
        path: entry.path,
        auto: true,
      };
      if (entry.kind === 'dir') {
        node.scanned = previous ? !!previous.scanned : false;
      } else {
        node.size = entry.size;
        node.mtime = entry.mtime;
        node.ext = extname(entry.name);
      }
      upsertNodes[nodeId] = node;
      link(dirId, nodeId, 'contains');
    }

    const deleteNodes = [];
    if (prune) {
      for (const child of store.children(dirId)) {
        if (child.auto && child.path && dirname(child.path) === clean && !seen.has(child.id)) deleteNodes.push(child.id);
      }
    }

    graph.commit({
      label: `scan ${clean}`,
      upsertNodes,
      upsertEdges,
      deleteNodes,
      coalesceKey: 'scan:' + clean,
    });
    return { ok: true, path: clean, count: entries.length, ids: Object.keys(upsertNodes), dirId };
  }

  function openWindow(appId, { instanceId, x, y, w, h, file = null, title = null } = {}) {
    const meta = appMeta(appId);
    const instance = instanceId || createId('i', appId);
    const nodeId = NODE_ID.window(instance);
    const upsertNodes = {
      [nodeId]: {
        id: nodeId,
        type: 'window',
        name: title || meta.title,
        title: title || meta.title,
        appId,
        instance,
        x: Math.round(x || 0),
        y: Math.round(y || 0),
        w: Math.round(w || meta.size[0]),
        h: Math.round(h || meta.size[1]),
        minimized: false,
        maximized: false,
        docked: null,
        file: file || null,
        openedAt: Date.now(),
        auto: true,
      },
    };
    const upsertEdges = {};
    const link = (from, to, kind) => {
      const id = edgeId(from, to, kind);
      upsertEdges[id] = { id, from, to, kind };
    };
    if (graph.store.hasNode('sys:shell')) link('sys:shell', nodeId, 'contains');
    if (file) {
      const fileId = NODE_ID.file(file);
      if (!graph.store.hasNode(fileId)) upsertNodes[fileId] = { id: fileId, type: 'file', name: basename(file), path: normalizePath(file), auto: true };
      link(nodeId, fileId, 'opens');
    }
    graph.commit({ label: `open ${meta.title}`, upsertNodes, upsertEdges });
    return { instance, nodeId };
  }

  function setWindow(instance, patch) {
    const nodeId = NODE_ID.window(instance);
    const node = graph.store.node(nodeId);
    if (!node) return false;
    graph.commit({
      label: `update ${node.title || node.appId}`,
      upsertNodes: { [nodeId]: { ...node, ...patch, id: nodeId, type: 'window' } },
      coalesceKey: 'win:' + instance,
    });
    return true;
  }

  function attach(appId, { instanceId, windowId = null, title = null } = {}) {
    const meta = appMeta(appId);
    const instance = instanceId || createId('i', appId) || `i${++instanceSeq}`;
    const procId = NODE_ID.process(instance);
    const appIdNode = NODE_ID.app(appId);
    const upsertNodes = {
      [procId]: {
        id: procId,
        type: 'process',
        name: title || meta.title,
        appId,
        instance,
        status: 'running',
        pid: state.pid++,
        startedAt: Date.now(),
        windowId,
        auto: true,
      },
    };
    const upsertEdges = {};
    const link = (from, to, kind) => {
      const id = edgeId(from, to, kind);
      upsertEdges[id] = { id, from, to, kind };
    };
    if (graph.store.hasNode(appIdNode)) link(appIdNode, procId, 'launches');
    if (windowId && graph.store.hasNode(NODE_ID.window(windowId))) link(procId, NODE_ID.window(windowId), 'owns');
    if (graph.store.node('svc:bus')) link(procId, 'svc:bus', 'communicates');
    graph.commit({ label: `start ${meta.title}`, upsertNodes, upsertEdges });
    instances.set(instance, { appId, procId, windowId, title: meta.title, at: Date.now() });
    return { instance, procId };
  }

  function detach(instance) {
    const procId = NODE_ID.process(instance);
    const has = graph.store.hasNode(procId);
    instances.delete(instance);
    if (!has) return false;
    graph.commit({ label: 'exit process', deleteNodes: [procId] });
    return true;
  }

  function closeWindow(instance) {
    const winId = NODE_ID.window(instance);
    const procId = NODE_ID.process(instance);
    const deleteNodes = [];
    if (graph.store.hasNode(winId)) deleteNodes.push(winId);
    if (graph.store.hasNode(procId)) deleteNodes.push(procId);
    instances.delete(instance);
    if (!deleteNodes.length) return false;
    const node = graph.store.node(winId);
    graph.commit({ label: `close ${(node && node.title) || instance}`, deleteNodes });
    return true;
  }

  async function openFile(path, { app = null } = {}) {
    const clean = normalizePath(path);
    const info = await fs.stat(clean);
    if (!info) return { ok: false, error: 'ENOENT: ' + clean };
    if (info.kind === 'dir') {
      bus.emit('Shell', 'open-app', { app: 'explorer', file: clean, filename: basename(clean) });
      return { ok: true, app: 'explorer', path: clean, kind: 'dir' };
    }
    const appId = resolveApp(clean, app);
    bus.emit('Shell', 'open-app', { app: appId, file: clean, filename: basename(clean) });
    return { ok: true, app: appId, path: clean, kind: 'file' };
  }

  function setTheme(mode, wallpaper) {
    const node = themeNode();
    if (!node) return null;
    const patch = { mode: mode === 'xp' ? 'xp' : 'dark' };
    if (wallpaper != null) patch.wallpaper = Number(wallpaper);
    graph.commit({ label: `theme ${patch.mode}`, upsertNodes: { 'svc:theme': { ...node, ...patch, id: 'svc:theme', type: 'service' } } });
    return syncTheme();
  }

  function clientFor(appId, { instance = null, windowId = null, attach: shouldAttach = true, boot = null } = {}) {
    const meta = appMeta(appId);
    const instanceId = instance || createId('i', appId);
    const store = () => graph.store;

    const client = {
      app: appId,
      instance: instanceId,
      windowId: windowId || instanceId,
      BOOT: Object.assign({}, boot || {}, { app: appId, instance: instanceId, windowId: windowId || instanceId }),
      meta,
      kernel,
      state,
      fs: fs.scoped(appId),
      graph: store,
      node: (id) => store().node(id),
      nodes: () => store().nodes,
      stats: () => store().stats(),
      children: (id, kind) => store().children(id, kind),
      emit: (event, payload) => bus.emit(appId, event, payload),
      on: (a, b, d) => (typeof d === 'function' ? bus.on(a, b, d) : bus.on(appId, a, b)),
      subscribe: (scope, event, fn) => bus.on(scope, event, fn),
      onAny: (fn) => bus.on('*', '*', fn),
      handle: (event, fn) => bus.handle(appId, event, fn),
      call: (scope, event, payload, options) => bus.call(scope, event, payload, options),
      onLog: (fn) => bus.onLog(fn),
      onGraph: (fn) => graph.subscribe(fn),
      theme() {
        const node = store().node('svc:theme');
        return { mode: node && node.mode === 'xp' ? 'xp' : 'dark', wallpaper: Number((node && node.wallpaper) || 0) };
      },
      onTheme(fn) {
        fn(client.theme());
        return graph.subscribe(() => fn(client.theme()));
      },
      setTheme: (mode, wallpaper) => setTheme(mode, wallpaper),
      open: (path, app) => openFile(path, { app }),
      launch: (app, options = {}) => bus.emit('Shell', 'open-app', Object.assign({ app }, options)),
      scan: (path) => scan(path),
      commit: (tx) => graph.commit(tx),
      undo: () => graph.undo(),
      redo: () => graph.redo(),
      setStatus: (text) => bus.emit('Shell', 'status', { text: String(text) }),
      setTitle: (title) => bus.emit('Shell', 'set-title', { instance: instanceId, title: String(title) }),
      setWindow: (patch) => setWindow(instanceId, patch),
      close: () => bus.emit('Shell', 'close-app', { instance: instanceId }),
      detach: () => detach(instanceId),
    };

    if (shouldAttach) attach(appId, { instanceId, windowId: windowId || instanceId });
    return client;
  }

  const kernel = {
    bus,
    graph,
    fs,
    state,
    NODE_ID,
    NODE_STYLE,
    EDGE_STYLE,
    APPS,
    DESKTOP_ORDER,
    WALLPAPERS,
    appMeta,
    resolveApp,
    joinedPath: joinPath,
    scan,
    openWindow,
    setWindow,
    attach,
    detach,
    closeWindow,
    openFile,
    setTheme,
    clientFor,
    theme() {
      return syncTheme();
    },
    graphJSON() {
      return graph.toJSON();
    },
    instances,
  };

  bus.handle('Kernel', 'ping', () => ({ ok: true, at: Date.now(), fs: fs.kind }));
  bus.handle('Kernel', 'stats', () => ({ graph: graph.store.stats(), bus: bus.stats(), fs: fs.kind, uptime: Date.now() - state.bootedAt, windows: state.windows.length }));
  bus.handle('Kernel', 'app-list', () => ({ apps: APPS, order: DESKTOP_ORDER }));
  bus.handle('Kernel', 'open-file', (payload = {}) => openFile(payload.path, { app: payload.app }));
  bus.handle('Kernel', 'launch', ({ app, file, filename } = {}) => {
    bus.emit('Shell', 'open-app', { app, file, filename });
    return { ok: true, app };
  });
  bus.handle('Kernel', 'attach', ({ app, instance, windowId } = {}) => attach(app, { instanceId: instance, windowId: windowId || null }));
  bus.handle('Kernel', 'detach', ({ instance } = {}) => ({ ok: detach(instance) }));
  bus.handle('Kernel', 'fs:scan', ({ path } = {}) => scan(path || '/'));
  bus.handle('Kernel', 'fs:list', ({ path } = {}) => fs.list(path || '/'));
  bus.handle('Kernel', 'fs:read-text', ({ path } = {}) => ({ text: fs.readText(path) }));
  bus.handle('Kernel', 'fs:write-text', ({ path, text } = {}) => fs.writeText(path, text));
  bus.handle('Kernel', 'fs:stat', ({ path } = {}) => fs.stat(path));
  bus.handle('Kernel', 'fs:mkdir', ({ path } = {}) => ({ path: fs.mkdir(path) }));
  bus.handle('Kernel', 'fs:remove', ({ path } = {}) => ({ path: fs.remove(path) }));
  bus.handle('Kernel', 'fs:estimate', () => fs.estimate());
  bus.handle('Kernel', 'fs:send-to-app', ({ app, file, filename } = {}) => {
    bus.emit(app, 'open-file', { path: file, filename: filename || basename(file || '') });
    return { ok: true };
  });
  bus.handle('Kernel', 'theme:set', ({ mode, wallpaper } = {}) => ({ theme: setTheme(mode, wallpaper) }));
  bus.handle('Kernel', 'wallpapers', () => ({ wallpapers: WALLPAPERS }));

  bus.on('Kernel', 'fs:changed', ({ path } = {}) => {
    if (!path) return;
    const dir = dirname(path);
    const dirId = NODE_ID.dir(dir);
    const node = graph.store.node(dirId);
    if (node && node.scanned) scan(dir).catch(() => {});
  });

  graph.subscribe((event) => {
    if (event.action === 'commit' || event.action === 'undo' || event.action === 'redo' || event.action === 'jump' || event.action === 'replace' || event.action === 'load') {
      if (event.graph.nodes['svc:theme']) syncTheme();
    }
  });

  ensureRegistryNodes();
  syncTheme();
  graph.bind(bus);

  globalThis.subkernel = kernel;
  globalThis.cloudos = kernel;
  state.ready = true;

  Promise.resolve()
    .then(async () => {
      const root = graph.store.node('dir:/');
      if (!root || !root.scanned) await scan('/');
    })
    .catch((error) => console.warn('[Kernel] initial scan failed', error));

  return kernel;
}
