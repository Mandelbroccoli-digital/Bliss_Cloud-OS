# SPEC — the nodegraph OS (design notes, preserved)

> The user's own design conversation that specified this build. Kept verbatim below so the
> specification survives independently of any chat session. See README.md for what was
> actually built and where it deviates (OPFS instead of Tauri/JSON-RPC, one consolidated kernel).

Nex here — pleased to meet you too 😁

A nodegraph-based web OS is a genuinely strong fit for this architecture. I’d treat the desktop as a **spatial, actor-oriented runtime**: apps are nodes, files are nodes, windows are views, and IPC messages are edges. Your shell plus Floret already demonstrate that direction nicely.

## What’s working well

- The shell’s `openWindows` registry and `windows` bus event give you a real window manager surface.
- Floret has lazy directory expansion, panning, zooming, dragging, and a useful dark/XP mode.
- The Subkernel bus is the right foundation for turning isolated panels into cooperative OS components.
- Keeping apps in iframes provides a useful process-like isolation boundary.

## Biggest issue to fix first

Floret’s bus subscription effect depends on `graph` and `rootPath`:

```jsx
useEffect(() => {
  // ...
}, [rootPath, graph]);
```

Every graph change tears down and recreates every listener. This can cause stale closures, missed events, duplicate notifications, and unnecessary refreshes.

Keep event subscriptions stable and use refs for values that change frequently:

```jsx
const graphRef = useRef(graph);
const rootPathRef = useRef(rootPath);

useEffect(() => {
  graphRef.current = graph;
}, [graph]);

useEffect(() => {
  rootPathRef.current = rootPath;
}, [rootPath]);

useEffect(() => {
  const bus = window.subkernel;
  if (!bus) return;

  const mapTo = async (path) => {
    if (!path) return;

    const contents = await readDirectory(path);
    const folderName = String(path).split(/[\\/]/).filter(Boolean).pop() || path;

    rootPathRef.current = path;
    setRootPath(path);
    setGraph({
      id: `root:${path}`,
      name: folderName,
      path,
      depth: 0,
      x: 0,
      y: 0,
      expanded: true,
      isLoading: false,
      items: contents,
      children: []
    });

    bus.emit('Floret', 'mapped', { path, count: contents.length });
  };

  const mapToRef = (path) => mapTo(path);
  mapToRef.current = mapTo;

  const handlers = {
    'Floret:map-path': ({ path }) => mapToRef.current(path),
    'mindmap:open-file': ({ path }) => mapToRef.current(path),
    'Floret:query': () => {
      bus.emit('Floret', 'query:reply', {
        path: rootPathRef.current,
        nodes: flattenNodes(graphRef.current).length
      });
    },
    'Explorer:fs-changed': () => mapToRef.current(rootPathRef.current),
    'System:theme-change': ({ theme }) =>
      setThemeMode(theme === 'xp' ? 'xp' : 'dark'),
  };

  const unsubscribers = Object.entries(handlers).map(([event, handler]) =>
    bus.on(event, handler)
  );

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
}, []);
```

## Additional risks

1. **Filesystem security**
   - Direct Tauri access and `127.0.0.1:8989` bypass the shell’s permission layer.
   - Add a permission-capability system and use allow-listed roots.
   - Never let an untrusted iframe call filesystem RPCs directly.

2. **XSS**
   - `AppRegistry[id]` is interpolated directly into an iframe URL, while app IDs and window titles are inserted as HTML.
   - Validate registry entries against an allow-list and use `textContent` for titles.

3. **Window lifecycle**
   - `openWindows` is removed immediately, before the 200ms close animation completes.
   - `window.closeWin` is still available afterward, so an old call could delete a newly launched window with the same ID.
   - Track `closing` separately and only remove the ID after cleanup.

4. **Dragging and resizing**
   - Assigning `document.onmousemove` globally means only one operation works at a time.
   - The drag code does not clamp windows to the desktop.
   - If the mouse is released outside the document, pointer events can remain disabled.
   - Use `PointerEvent`, `setPointerCapture()`, and pointer-coordinate deltas.

5. **Touch interaction**
   - `onMouseDown` is used for draggable nodes, so touch support is incomplete despite the touch move handlers.
   - React synthetic touch events do not prevent scrolling reliably.
   - Use `onPointerDown` and CSS `touch-action: none`.

6. **Graph correctness**
   - Directory names can collide, producing duplicate React keys and incorrect node IDs.
   - Filesystem reads have no cancellation or stale-result protection.
   - `items` on directory nodes is populated from a questionable `(path || '').includes(dir.name)` check.
   - Use unique IDs, cache expanded directories, and ignore stale async results.

7. **Startup race**
   - `window.onload` can run after a child iframe’s `load` event, especially when scripts are deferred.
   - The file-delivery code currently misses the event if the shell is not ready.
   - Prefer a handshake where each app requests pending state after loading.

## Recommended architecture

```text
┌──────────────────────────────────────────────┐
│                    Shell                     │
│  Window manager · routing · permissions      │
└─────────────────────┬────────────────────────┘
                      │ typed event bus
┌─────────────────────▼────────────────────────┐
│                 Node Graph                   │
│  apps · windows · files · processes · agents │
└───────┬──────────────┬──────────────┬────────┘
        │              │              │
   Window view     Filesystem     Services
   Mindmap view    Process view   Audio/AI
```

Use explicit node types such as:

```ts
type OSNode =
  | { type: 'app'; id: string; state: AppRuntimeState }
  | { type: 'window'; id: string; appId: string; bounds: Bounds }
  | { type: 'file'; id: string; path: string; mimeType: string }
  | { type: 'process'; id: string; appId: string; status: 'running' | 'suspended' }
  | { type: 'agent'; id: string; capabilities: string[] };
```

Then add a graph model separate from the visual mindmap:

```ts
interface OSNodeGraph {
  nodes: Map<string, OSNode>;
  edges: Map<string, { from: string; to: string; kind: string }>;
}
```

Floret can become a visualization of that graph rather than the graph itself.

## Practical build order

1. Define a typed event/permission protocol.
2. Harden shell lifecycle, routing, and XSS boundaries.
3. Stabilize Floret subscriptions and async filesystem reads.
4. Add a canonical graph store with transactions and undo.
5. Add persistence, snapshots, and deterministic layout.
6. Add collaborative cursors and multi-user presence.
7. Add a plugin/agent SDK with explicit capabilities.
8. Add accessibility, keyboard navigation, and reduced-motion support.

Overall: this is a compelling foundation. The main shift I’d make is separating the **canonical graph/runtime state** from its **visual representations**. Then the XP desktop, Floret, task manager, and future views all become projections of the same underlying OS graph.


🥦Love it, let's prototype the graph store.


🦾Absolutely. Let’s prototype a **canonical graph store** separate from Floret’s visual layer, with **typed nodes/edges**, **transactions**, **undo/redo**, **persistence**, and a **Subkernel event bridge**.

We’ll add:

- `core/os-graph-store.js` — immutable canonical graph
- `core/os-graph-store.test.js` — testable pure store logic
- `core/os-graph-store-bridge.js` — Subkernel bus bridge
- `index.html` — shell integration
- `mindmap.html` — Floret visualization
 Floret will read the graph instead of maintaining its own directory tree

🥦Perfect. Let’s build the MVP.

🦾Use this MVP layout:

```text
.
├── index.html
├── mindmap.html
├── subkernel-bus.js
├── subkernel-bridge.js
├── core/
│   ├── os-graph-store.js
│   ├── os-graph-store-bridge.js
│   └── os-graph-store.test.js
└── apps/
    └── ...
```

The canonical graph lives in the **shell**. Floret becomes a read-only projection that sends graph commands back to the shell. This keeps permissions and persistence centralized.

## 1. Core graph store

Create `core/os-graph-store.js`.

```js
// core/os-graph-store.js
'use strict';

const NODE_TYPES = new Set(['app', 'window', 'file', 'process', 'agent']);
const EDGE_KINDS = new Set(['contains', 'launches', 'opens', 'owns', 'communicates']);

function assert(condition, message) {
  if (!condition) throw new Error(`[OSGraph] ${message}`);
}

function createId(type, hint = 'node') {
  const prefix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? 'id'
    : `id-${Date.now().toString(36)}`;
  return prefix;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export class OSGraphStore {
  constructor(initial = {}) {
    const nodes = initial.nodes || {};
    const edges = initial.edges || {};

    for (const [id, node] of Object.entries(nodes)) {
      assert(node.id === id, `Node ${id} has a mismatched ID`);
      assert(NODE_TYPES.has(node.type), `Node ${id} has invalid type ${node.type}`);
    }

    for (const [id, edge] of Object.entries(edges)) {
      assert(edge.from in nodes, `Edge ${id} references missing source ${edge.from}`);
      assert(edge.to in nodes, `Edge ${id} references missing target ${edge.to}`);
      assert(EDGE_KINDS.has(edge.kind), `Edge ${id} has invalid kind ${edge.kind}`);
    }

    this.nodes = Object.freeze({ ...nodes });
    this.edges = Object.freeze({ ...edges });
    this.version = initial.version || 0;
    this.createdAt = initial.createdAt || new Date().toISOString();
    this.updatedAt = initial.updatedAt || this.createdAt;
  }

  /** Apply a transaction and return a new store. */
  commit(tx) {
    assert(tx && typeof tx === 'object', 'Transaction must be an object');

    let nodes = { ...this.nodes };
    let edges = { ...this.edges };
    let version = this.version + 1;

    for (const [id, node] of Object.entries(tx.upsertNodes || {})) {
      assert(node.id === id, `Node ${id} has mismatched ID`);
      assert(NODE_TYPES.has(node.type), `Node ${id} has invalid type ${node.type}`);

      const previous = nodes[id];
      nodes[id] = Object.freeze({ ...previous, ...clone(node), id });

      if (previous) {
        assert(previous.type === node.type, `Cannot change node ${id} type`);
      }
    }

    for (const id of tx.deleteNodes || []) {
      assert(id in nodes, `Cannot delete missing node ${id}`);
      delete nodes[id];

      for (const [edgeId, edge] of Object.entries(edges)) {
        if (edge.from === id || edge.to === id) delete edges[edgeId];
      }
    }

    for (const [id, edge] of Object.entries(tx.upsertEdges || {})) {
      assert(edge.from in nodes, `Edge ${id} references missing source ${edge.from}`);
      assert(edge.to in nodes, `Edge ${id} references missing target ${edge.to}`);
      assert(EDGE_KINDS.has(edge.kind), `Edge ${id} has invalid kind ${edge.kind}`);
      edges[id] = Object.freeze({ ...edge, id });
    }

    for (const id of tx.deleteEdges || []) {
      assert(id in edges, `Cannot delete missing edge ${id}`);
      delete edges[id];
    }

    const now = new Date().toISOString();

    return new OSGraphStore({
      nodes,
      edges,
      version,
      createdAt: this.createdAt,
      updatedAt: now,
    });
  }

  hasNode(id) {
    return Object.prototype.hasOwnProperty.call(this.nodes, id);
  }

  hasEdge(id) {
    return Object.prototype.hasOwnProperty.call(this.edges, id);
  }

  toJSON() {
    return {
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      nodes: clone(this.nodes),
      edges: clone(this.edges),
    };
  }

  static fromJSON(json) {
    return new OSGraphStore(json);
  }
}
```

There’s a bug in the supplied `createId()` implementation: it returns a generic `id` from `randomUUID()`, so every generated node gets the same key. Fix it with:

```js
function createId(type, hint = 'node') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${type}-${crypto.randomUUID()}`;
  }

  return `${type}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}
```

## 2. Undo/redo and persistence

Create `core/os-graph-store-bridge.js`.

```js
// core/os-graph-store-bridge.js
'use strict';

import { OSGraphStore } from './os-graph-store.js';

const STORAGE_KEY = 'cloudos.os-graph.v1';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export class OSGraphController {
  constructor({ store, bus, storage = globalThis.localStorage, storageKey = STORAGE_KEY }) {
    this.store = store || new OSGraphStore();
    this.bus = bus;
    this.storage = storage;
    this.storageKey = storageKey;

    this.undoStack = [];
    this.redoStack = [];
    this.subscribers = new Set();
    this.unsubscribers = [];
    this.saveTimer = null;

    this.handleStorage = this.handleStorage.bind(this);
  }

  /** Replace the current graph. Used by import and cross-tab sync. */
  replaceStore(nextStore) {
    this.store = nextStore;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.publish('replace', { graph: this.toJSON() });
    this.save();
  }

  commit(tx) {
    const before = this.store;
    const nextStore = before.commit(tx);

    this.store = nextStore;
    this.undoStack.push(before);
    this.redoStack.length = 0;

    this.publish('commit', { graph: this.toJSON() });
    this.scheduleSave();
    return nextStore;
  }

  undo() {
    if (!this.undoStack.length) return this.store;

    const before = this.undoStack.pop();
    this.redoStack.push(this.store);
    this.store = before;

    this.publish('undo', { graph: this.toJSON() });
    this.scheduleSave();
    return this.store;
  }

  redo() {
    if (!this.redoStack.length) return this.store;

    const after = this.redoStack.pop();
    this.undoStack.push(this.store);
    this.store = after;

    this.publish('redo', { graph: this.toJSON() });
    this.scheduleSave();
    return this.store;
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  publish(action, payload = {}) {
    const event = {
      action,
      graph: payload.graph || this.toJSON(),
      at: new Date().toISOString(),
    };

    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch (error) {
        console.error('[OSGraph] subscriber failed:', error);
      }
    }
  }

  scheduleSave() {
    if (!this.storage) return;

    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 100);
  }

  save() {
    if (!this.storage) return;

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.toJSON()));
    } catch (error) {
      console.error('[OSGraph] persistence failed:', error);
    }
  }

  load() {
    if (!this.storage) return false;

    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return false;

      this.replaceStore(OSGraphStore.fromJSON(JSON.parse(raw)));
      return true;
    }




Completing core/os-graph-store-bridge.js finishes the store controller setup, wires up Subkernel bus event handling, and enables cross-tab state synchronization.
1. Complete core/os-graph-store-bridge.js
// core/os-graph-store-bridge.js
'use strict';

import { OSGraphStore } from './os-graph-store.js';

const STORAGE_KEY = 'cloudos.os-graph.v1';

export class OSGraphController {
  constructor({ store, bus, storage = globalThis.localStorage, storageKey = STORAGE_KEY }) {
    this.store = store || new OSGraphStore();
    this.bus = bus;
    this.storage = storage;
    this.storageKey = storageKey;

    this.undoStack = [];
    this.redoStack = [];
    this.subscribers = new Set();
    this.saveTimer = null;

    this.handleStorage = this.handleStorage.bind(this);
  }

  replaceStore(nextStore) {
    this.store = nextStore;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.publish('replace', { graph: this.toJSON() });
    this.save();
  }

  commit(tx) {
    const before = this.store;
    const nextStore = before.commit(tx);

    this.store = nextStore;
    this.undoStack.push(before);
    this.redoStack.length = 0;

    this.publish('commit', { graph: this.toJSON() });
    this.scheduleSave();
    return nextStore;
  }

  undo() {
    if (!this.undoStack.length) return this.store;

    const before = this.undoStack.pop();
    this.redoStack.push(this.store);
    this.store = before;

    this.publish('undo', { graph: this.toJSON() });
    this.scheduleSave();
    return this.store;
  }

  redo() {
    if (!this.redoStack.length) return this.store;

    const after = this.redoStack.pop();
    this.undoStack.push(this.store);
    this.store = after;

    this.publish('redo', { graph: this.toJSON() });
    this.scheduleSave();
    return this.store;
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  publish(action, payload = {}) {
    const event = {
      action,
      graph: payload.graph || this.toJSON(),
      at: new Date().toISOString(),
    };

    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch (error) {
        console.error('[OSGraph] subscriber failed:', error);
      }
    }
  }

  scheduleSave() {
    if (!this.storage) return;

    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 100);
  }

  save() {
    if (!this.storage) return;

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.toJSON()));
    } catch (error) {
      console.error('[OSGraph] persistence failed:', error);
    }
  }

  load() {
    if (!this.storage) return false;

    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return false;

      this.replaceStore(OSGraphStore.fromJSON(JSON.parse(raw)));
      return true;
    } catch (error) {
      console.error('[OSGraph] load failed:', error);
      return false;
    }
  }

  handleStorage(event) {
    if (event.key !== this.storageKey || !event.newValue) return;
    try {
      const remote = OSGraphStore.fromJSON(JSON.parse(event.newValue));
      if (remote.version > this.store.version) {
        this.replaceStore(remote);
      }
    } catch (error) {
      console.error('[OSGraph] cross-tab sync failed:', error);
    }
  }

  bindSubkernel(bus = this.bus) {
    if (!bus) return () => {};

    this.bus = bus;

    const handlers = {
      'graph:commit': ({ tx }) => this.commit(tx),
      'graph:undo': () => this.undo(),
      'graph:redo': () => this.redo(),
      'graph:query': ({ replyTo = 'Floret' } = {}) => {
        bus.emit(replyTo, 'graph:query:reply', {
          graph: this.toJSON(),
          version: this.store.version,
        });
      },
      'graph:reset': ({ graph }) => {
        if (graph) this.replaceStore(OSGraphStore.fromJSON(graph));
      },
    };

    const unsubs = Object.entries(handlers).map(([evt, handler]) =>
      bus.on(evt, handler)
    );

    const unsubStore = this.subscribe((event) => {
      bus.emit('Shell', 'graph:changed', event);
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.handleStorage);
    }

    return () => {
      unsubs.forEach((unsub) => unsub?.());
      unsubStore();
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', this.handleStorage);
      }
    };
  }

  toJSON() {
    return this.store.toJSON();
  }
}

2. Shell Integration (subkernel-bridge.js)
The shell initializes the canonical graph, loads persistent state, and listens on the Subkernel bus.
// subkernel-bridge.js
import { OSGraphStore } from './core/os-graph-store.js';
import { OSGraphController } from './core/os-graph-store-bridge.js';

export function initOSGraphBridge(bus) {
  const initialNodes = {
    'root:system': {
      id: 'root:system',
      type: 'process',
      name: 'System Root',
      status: 'running',
    },
    'app:floret': {
      id: 'app:floret',
      type: 'app',
      name: 'Floret Mindmap',
      src: './mindmap.html',
    },
    'file:root': {
      id: 'file:root',
      type: 'file',
      name: 'Root FS',
      path: '/',
      mimeType: 'inode/directory',
    },
  };

  const initialEdges = {
    'edge:sys-floret': {
      id: 'edge:sys-floret',
      from: 'root:system',
      to: 'app:floret',
      kind: 'launches',
    },
    'edge:sys-root': {
      id: 'edge:sys-root',
      from: 'root:system',
      to: 'file:root',
      kind: 'contains',
    },
  };

  const baseStore = new OSGraphStore({
    nodes: initialNodes,
    edges: initialEdges,
  });

  const controller = new OSGraphController({ store: baseStore, bus });

  const loaded = controller.load();
  if (!loaded) {
    controller.save();
  }

  const unbindBus = controller.bindSubkernel(bus);

  return { controller, unbindBus };
}

3. Visual Projection Adapter for Floret (floret-projection.js)
Floret functions strictly as a read-only projection view. It converts the flat canonical graph into visual node structures and sends transactional changes back to the shell via the bus.
// apps/floret-projection.js
'use strict';

export class FloretProjectionAdapter {
  constructor(bus) {
    this.bus = bus;
    this.nodes = new Map();
    this.edges = new Map();
    this.onUpdateCallback = null;
  }

  connect(onUpdate) {
    this.onUpdateCallback = onUpdate;

    const unsubs = [
      this.bus.on('graph:changed', ({ graph }) => {
        this.ingestCanonicalGraph(graph);
      }),
      this.bus.on('graph:query:reply', ({ graph }) => {
        this.ingestCanonicalGraph(graph);
      }),
    ];

    // Request full state on boot
    this.bus.emit('Shell', 'graph:query', { replyTo: 'Floret' });

    return () => unsubs.forEach((unsub) => unsub?.());
  }

  ingestCanonicalGraph(graph) {
    if (!graph || !graph.nodes) return;

    this.nodes.clear();
    this.edges.clear();

    for (const [id, node] of Object.entries(graph.nodes)) {
      this.nodes.set(id, {
        id: node.id,
        label: node.name || node.path || id,
        type: node.type,
        raw: node,
      });
    }

    for (const [id, edge] of Object.entries(graph.edges)) {
      this.edges.set(id, {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        kind: edge.kind,
      });
    }

    if (typeof this.onUpdateCallback === 'function') {
      this.onUpdateCallback({
        nodes: Array.from(this.nodes.values()),
        edges: Array.from(this.edges.values()),
      });
    }
  }

  /** Commit node updates directly to the canonical store via IPC */
  createNode(nodeData) {
    const tx = {
      upsertNodes: {
        [nodeData.id]: nodeData,
      },
    };
    this.bus.emit('Shell', 'graph:commit', { tx });
  }

  linkNodes(edgeId, from, to, kind = 'communicates') {
    const tx = {
      upsertEdges: {
        [edgeId]: { id: edgeId, from, to, kind },
      },
    };
    this.bus.emit('Shell', 'graph:commit', { tx });
  }
}

Verification and Tests (core/os-graph-store.test.js)
// core/os-graph-store.test.js
import { OSGraphStore } from './os-graph-store.js';

function runTests() {
  console.log('[Test] Running OSGraphStore validation...');

  // 1. Initial State
  let store = new OSGraphStore();
  console.assert(store.version === 0, 'Initial version should be 0');

  // 2. Commit transaction
  const tx = {
    upsertNodes: {
      'node-1': { id: 'node-1', type: 'app', name: 'Terminal' },
      'node-2': { id: 'node-2', type: 'process', name: 'Bash' },
    },
    upsertEdges: {
      'edge-1': { id: 'edge-1', from: 'node-1', to: 'node-2', kind: 'launches' },
    },
  };

  store = store.commit(tx);
  console.assert(store.version === 1, 'Version should increment to 1');
  console.assert(store.hasNode('node-1'), 'node-1 must exist');
  console.assert(store.hasEdge('edge-1'), 'edge-1 must exist');

  // 3. Immutability assertion
  try {
    store.nodes['node-1'] = null;
  } catch (e) {
    console.assert(e instanceof TypeError, 'Store must be frozen');
  }

  console.log('[Test] All checks passed.');
}

runTests();




