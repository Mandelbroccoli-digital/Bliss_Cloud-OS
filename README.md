# CloudOS — a nodegraph operating system

A desktop operating system that runs entirely in a Perchance generator. Its canonical state is a
**typed property graph** (nodes + edges) with transactions, undo/redo, time travel and persistence.
Everything you see is a **projection** of that one graph.

`src/SPEC.md` is the user's original design conversation (the specification this was built from) —
read it first if you need to know *why* something is shaped the way it is.

```
index.html                  shell document: desktop, taskbar, window manager, boot
main.pjs                    $meta + pjs-level boot config (`defaults` list)
src/kernel/bus.js           typed, addressable pub/sub + RPC over correlation ids, with a log ring buffer
src/kernel/graph.js         immutable OSGraphStore: typed nodes/edges, atomic validated commits
src/kernel/graph-controller.js  history/time-travel, undo/redo, persistence, snapshots, bus bridge
src/kernel/fs.js            real filesystem over OPFS (memory fallback) with per-app permission scopes
src/kernel/registry.js      app registry, node-type/edge-kind visual metadata, file→app resolution
src/kernel/kernel.js        boot: wires bus + graph + fs + registry; owns window/process/scan mutations
src/shell/shell.js          window manager: projects window nodes onto the desktop (two-way)
src/shell/shell.css         shell chrome, dark + Windows XP themes
src/apps/app-kit.js         app-side runtime (`CloudOS.connect/kernel/theme/...`) — injected into each app
src/apps/app.css            shared app styling (dark + XP CSS variables)
src/apps/*.html             apps: floret, explorer, notepad, terminal, inspector, taskmanager,
                            player, viewer, controlpanel, about
```

## The model

Node types: `app`, `window`, `file`, `dir`, `process`, `agent`, `service`.
Edge kinds: `contains`, `launches`, `opens`, `owns`, `communicates`, `mounts`, `spawns`, `reads`, `writes`.

```
sys:kernel --owns-->      svc:bus | svc:graph | svc:fs | svc:theme
sys:kernel --spawns-->    sys:shell
sys:shell  --communicates--> svc:bus
svc:fs     --mounts-->    dir:/            (rootfs, indexed lazily)
sys:shell  --contains-->  app:<id>  (registry)  and  win:<instance>  (open windows)
app:<id>   --launches-->  proc:<instance> --owns--> win:<instance> --opens--> file:<path>
dir:<path> --contains-->  dir:<path> | file:<path>
```

Id conventions: `app:<id>`, `proc:<instance>`, `win:<instance>`, `dir:<abs>`, `file:<abs>`,
`svc:<name>`, `sys:<name>`. An instance id is shared by a window node and its process node, so
closing a window deletes exactly those two nodes (and everything incident).

## Rules the code follows

- **Only transactions change the graph.** `kernel.graph.commit({label, upsertNodes, deleteNodes, upsertEdges, deleteEdges, coalesceKey})`.
  Validation happens for the whole transaction before anything is applied; node types are immutable;
  deleting a node deletes its incident edges. Each commit produces a *new* frozen store, so undo,
  redo, time travel (jump to any history entry) and cross-tab sync come for free.
- **Apps never touch the store directly.** An app gets a client from `CloudOS.connect(appId)`; every
  mutation goes back through the kernel (window creation, filesystem scan, theme changes, window
  geometry). The filesystem handed to an app is `kernel.fs.scoped(appId)` and enforces a root
  allow-list (default: read `/*`, write `/home/*`).
- **The shell is a two-way projection.** Graph changes re-render the desktop, and the shell
  *reconciles*: a window node without a DOM window is mounted (`Shell:reconcile`), a DOM window whose
  node has gone is destroyed. That is why `Ctrl+Z` after closing a window really reopens it.
- **Theme is data.** `svc:theme.mode` / `.wallpaper` live in the graph; the shell, Floret and every
  app subscribe and re-style themselves.
- **Filesystem changes flow into the graph.** `fs` emits `Kernel:fs:changed`; the kernel re-scans the
  affected directory and commits `dir`/`file` nodes + `contains` edges (auto-generated nodes are
  marked `auto:true` and pruned on re-scan).
- **The Media Player is a service, not a special case.** `src/apps/player.html` keeps its status in
  the `svc:player` service node (playing, track, trackPath, volume, eq, shuffle, repeat, queue) via
  coalesced `player state` commits, and reuses the graph for everything else: loading a track commits
  a `win:<instance> --opens--> file:<path>` edge (scanning the directory first if the file isn't
  indexed), so playback shows up in Floret and the graph inspector like any other open. It listens for
  `player:set-volume` / `play` / `pause` / `next` / `prev` bus events and serves `player:get-state`
  and `player:load` RPCs, so other projections can drive it. Audio extensions resolve to it
  (`resolveApp`) ahead of the generic Viewer.
- **Apps run in iframes for isolation.** They are mounted as `srcdoc` documents (same-origin, so
  `window.parent.subkernel` works) with `app.css` + `app-kit.js` + a `window.CLOUDOS_BOOT` payload
  injected into `<head>` by the shell. No app ships a module import; the kit is a plain script.

## App protocol (bus)

Events are addressed `scope:event`. Bus API: `on(scope, event, fn)` (2-arg form = own app scope),
`emit(event, payload)` (own scope), `call(scope, event, payload)` → correlation-id RPC, `handle(...)`
to serve RPC, `onLog(fn)` for the live monitor.

- shell → app: `open-file` `{path, filename}`; app → shell: `open-app`, `close-app`, `focus-app`,
  `minimize-app`, `maximize-app`, `dock-app`, `set-title`, `status`, `flash`, `windows-request`,
  `tile-all`, `cascade-all`, `close-all`, `reload`, `factory-reset`, `wallpaper`.
- shell → everyone: `Shell:windows` (ephemeral focus/z/visibility view), `Shell:ready`.
- kernel RPC: `Kernel:graph:*` (commit/query/undo/redo/jump/snapshot(s)/restore/import/export/patch-node),
  `Kernel:fs:*` (scan/list/stat/read-text/write-text/mkdir/remove/estimate), `Kernel:open-file`,
  `Kernel:launch`, `Kernel:attach`/`detach`, `Kernel:stats`, `Kernel:ping`.
- `Kernel:graph:changed` is broadcast on every commit/undo/redo/jump/load with the full graph JSON.
  (Large payloads are truncated in the bus history but delivered intact to listeners.)

## Persistence

- Graph: `localStorage['cloudos.graph.v1']` (debounced 150 ms) + `cloudos.graph.snapshots.v1` for
  named snapshots. Undo history itself is in-memory only.
- Files: Origin Private File System (`navigator.storage.getDirectory()`), seeded on first boot with
  `/home/{Desktop,Documents,Projects,Pictures}`, `/system`, `/etc`. If OPFS is unavailable the fs
  falls back to an in-memory implementation with the same API.
- Window layout, open windows, theme and wallpaper all survive a reload because they are graph data.

## Keyboard

`Ctrl+Z` / `Ctrl+Shift+Z` undo/redo any graph transaction (the whole OS) · ``Ctrl+` `` window switcher
(↑↓ + Enter) · `F6` reload shell · double-click a desktop icon to launch · edges resize windows.

## Adapted from the Tauri prototype

The original sketch (`Unified_core.md`, kept in `scratch/` during that session) used Tauri `invoke`
plus a `127.0.0.1:8989` JSON-RPC filesystem and a `subkernel-bus.js`/`subkernel-bridge.js` pair. Here:

- the filesystem is the browser's OPFS — real, persistent, sandboxed, no native shell;
- bus + registry + app routing are consolidated into `src/kernel/*` behind one `window.subkernel`;
- Floret no longer owns a directory tree; it is a read-only projection that sends `fs:scan` /
  `graph:commit` commands back to the kernel (dragging a node commits its `layout`).

## Todo

- Presence + collaborative cursors over `server-plugin` (multi-user graph sync, remote cursors in Floret).
- Graph diffs instead of full-graph broadcasts for large graphs.
- Agent nodes with real capability manifests and a plugin/agent SDK.
- Accessibility pass (keyboard-only window management, reduced motion).
- A wasm/native-ish terminal (real command surface for third-party binaries).
