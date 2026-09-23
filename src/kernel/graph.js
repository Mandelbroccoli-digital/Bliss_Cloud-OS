'use strict';

export const NODE_TYPES = new Set(['app', 'window', 'file', 'dir', 'process', 'agent', 'service']);
export const EDGE_KINDS = new Set(['contains', 'launches', 'opens', 'owns', 'communicates', 'mounts', 'spawns', 'reads', 'writes']);

export function registerNodeType(type) {
  NODE_TYPES.add(type);
}
export function registerEdgeKind(kind) {
  EDGE_KINDS.add(kind);
}

function fail(message) {
  throw new Error('[Graph] ' + message);
}
function assert(condition, message) {
  if (!condition) fail(message);
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export function createId(type, hint) {
  const suffix =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return hint ? `${type}:${hint}:${suffix}` : `${type}:${suffix}`;
}

export function edgeId(from, to, kind = 'contains') {
  return `e:${from}->${to}:${kind}`;
}

function requireNode(id, node) {
  assert(node && typeof node === 'object' && !Array.isArray(node), `node "${id}" must be an object`);
  assert(node.id === id, `node "${id}" has a mismatched id ("${node.id}")`);
  assert(typeof node.type === 'string', `node "${id}" is missing a type`);
  assert(NODE_TYPES.has(node.type), `node "${id}" has unknown type "${node.type}"`);
}

function requireEdge(id, edge, nodes) {
  assert(edge && typeof edge === 'object' && !Array.isArray(edge), `edge "${id}" must be an object`);
  assert(edge.id === id, `edge "${id}" has a mismatched id ("${edge.id}")`);
  assert(typeof edge.from === 'string' && edge.from in nodes, `edge "${id}" references missing source "${edge.from}"`);
  assert(typeof edge.to === 'string' && edge.to in nodes, `edge "${id}" references missing target "${edge.to}"`);
  assert(typeof edge.kind === 'string', `edge "${id}" is missing a kind`);
  assert(EDGE_KINDS.has(edge.kind), `edge "${id}" has unknown kind "${edge.kind}"`);
}

export class OSGraphStore {
  #nodes;
  #edges;
  #out;
  #in;
  #byType;

  constructor(initial = {}) {
    const rawNodes = initial.nodes || {};
    const rawEdges = initial.edges || {};

    for (const [id, node] of Object.entries(rawNodes)) requireNode(id, node);
    for (const [id, edge] of Object.entries(rawEdges)) requireEdge(id, edge, rawNodes);

    const nodes = {};
    for (const [id, node] of Object.entries(rawNodes)) nodes[id] = deepFreeze(clone(node));
    const edges = {};
    for (const [id, edge] of Object.entries(rawEdges)) edges[id] = deepFreeze(clone(edge));

    this.#nodes = Object.freeze(nodes);
    this.#edges = Object.freeze(edges);
    this.version = initial.version || 0;
    this.createdAt = initial.createdAt || new Date().toISOString();
    this.updatedAt = initial.updatedAt || this.createdAt;
    this.#index();
  }

  #index() {
    const out = {};
    const into = {};
    const byType = {};
    for (const id of Object.keys(this.#nodes)) {
      const type = this.#nodes[id].type;
      (byType[type] || (byType[type] = [])).push(id);
      out[id] = [];
      into[id] = [];
    }
    for (const edge of Object.values(this.#edges)) {
      if (out[edge.from]) out[edge.from].push(edge.id);
      if (into[edge.to]) into[edge.to].push(edge.id);
    }
    this.#out = Object.freeze(out);
    this.#in = Object.freeze(into);
    this.#byType = Object.freeze(byType);
  }

  get nodes() {
    return this.#nodes;
  }
  get edges() {
    return this.#edges;
  }
  get size() {
    return Object.keys(this.#nodes).length;
  }

  node(id) {
    return this.#nodes[id] || null;
  }
  edge(id) {
    return this.#edges[id] || null;
  }
  hasNode(id) {
    return Object.prototype.hasOwnProperty.call(this.#nodes, id);
  }
  hasEdge(id) {
    return Object.prototype.hasOwnProperty.call(this.#edges, id);
  }
  ofType(type) {
    return (this.#byType[type] || []).map((id) => this.#nodes[id]);
  }
  count(type) {
    return (this.#byType[type] || []).length;
  }

  edgesFrom(id, kind) {
    const ids = this.#out[id] || [];
    const list = ids.map((eid) => this.#edges[eid]);
    return kind ? list.filter((edge) => edge.kind === kind) : list;
  }
  edgesTo(id, kind) {
    const ids = this.#in[id] || [];
    const list = ids.map((eid) => this.#edges[eid]);
    return kind ? list.filter((edge) => edge.kind === kind) : list;
  }
  children(id, kind = 'contains') {
    return this.edgesFrom(id, kind)
      .map((edge) => this.#nodes[edge.to])
      .filter(Boolean);
  }
  parents(id, kind = 'contains') {
    return this.edgesTo(id, kind)
      .map((edge) => this.#nodes[edge.from])
      .filter(Boolean);
  }
  neighbors(id) {
    const ids = new Set();
    for (const edge of this.edgesFrom(id)) ids.add(edge.to);
    for (const edge of this.edgesTo(id)) ids.add(edge.from);
    ids.delete(id);
    return [...ids].map((nid) => this.#nodes[nid]).filter(Boolean);
  }

  query({ type, where, limit = Infinity } = {}) {
    const source = type ? this.#byType[type] || [] : Object.keys(this.#nodes);
    const out = [];
    for (const id of source) {
      const node = this.#nodes[id];
      if (!where || where(node)) {
        out.push(node);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  stats() {
    const byKind = {};
    for (const edge of Object.values(this.#edges)) byKind[edge.kind] = (byKind[edge.kind] || 0) + 1;
    const byType = {};
    for (const type of Object.keys(this.#byType)) byType[type] = this.#byType[type].length;
    return {
      version: this.version,
      nodes: Object.keys(this.#nodes).length,
      edges: Object.keys(this.#edges).length,
      byType,
      byKind,
      updatedAt: this.updatedAt,
    };
  }

  commit(tx) {
    assert(tx && typeof tx === 'object', 'transaction must be an object');
    const upsertNodes = tx.upsertNodes || {};
    const upsertEdges = tx.upsertEdges || {};
    const deleteNodes = tx.deleteNodes || [];
    const deleteEdges = tx.deleteEdges || [];

    const nodes = { ...this.#nodes };
    const edges = { ...this.#edges };

    for (const [id, node] of Object.entries(upsertNodes)) {
      requireNode(id, node);
      const previous = nodes[id];
      if (previous) assert(previous.type === node.type, `cannot change node "${id}" type (${previous.type} -> ${node.type})`);
    }
    for (const id of deleteNodes) assert(id in nodes, `cannot delete missing node "${id}"`);

    for (const [id, node] of Object.entries(upsertNodes)) {
      const previous = nodes[id];
      nodes[id] = deepFreeze({ ...(previous || {}), ...clone(node), id, type: node.type });
    }
    for (const id of deleteNodes) {
      delete nodes[id];
      for (const [eid, edge] of Object.entries(edges)) {
        if (edge.from === id || edge.to === id) delete edges[eid];
      }
    }

    for (const [id, edge] of Object.entries(upsertEdges)) requireEdge(id, edge, nodes);
    for (const id of deleteEdges) assert(id in edges, `cannot delete missing edge "${id}"`);

    for (const [id, edge] of Object.entries(upsertEdges)) {
      edges[id] = deepFreeze({ ...(edges[id] || {}), ...clone(edge), id });
    }
    for (const id of deleteEdges) delete edges[id];

    return new OSGraphStore({
      nodes: clone(nodes),
      edges: clone(edges),
      version: this.version + 1,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
    });
  }

  toJSON() {
    return {
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      nodes: clone(this.#nodes),
      edges: clone(this.#edges),
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') fail('fromJSON requires an object');
    return new OSGraphStore(json);
  }

  static diff(before, after) {
    const addedNodes = [];
    const removedNodes = [];
    const changedNodes = [];
    const addedEdges = [];
    const removedEdges = [];
    for (const id of Object.keys(after.nodes)) {
      if (!before.hasNode(id)) addedNodes.push(id);
      else if (JSON.stringify(before.node(id)) !== JSON.stringify(after.node(id))) changedNodes.push(id);
    }
    for (const id of Object.keys(before.nodes)) if (!after.hasNode(id)) removedNodes.push(id);
    for (const id of Object.keys(after.edges)) if (!before.hasEdge(id)) addedEdges.push(id);
    for (const id of Object.keys(before.edges)) if (!after.hasEdge(id)) removedEdges.push(id);
    return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges, empty: !(addedNodes.length || removedNodes.length || changedNodes.length || addedEdges.length || removedEdges.length) };
  }
}
