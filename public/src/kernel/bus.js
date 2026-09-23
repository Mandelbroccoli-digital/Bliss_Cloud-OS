'use strict';

const RPC_REPLY_EVENT = 'rpc:reply';
const SEP = '\u0000';
const MAX_PAYLOAD = 1400;

function summarize(payload) {
  if (payload == null || typeof payload !== 'object') return payload;
  let text;
  try {
    text = JSON.stringify(payload);
  } catch (error) {
    return { __unserializable: true };
  }
  if (text && text.length > MAX_PAYLOAD) {
    return { __truncated: true, bytes: text.length, keys: Object.keys(payload).slice(0, 12) };
  }
  return payload;
}

function parseKey(key) {
  const i = key.indexOf(SEP);
  return [key.slice(0, i), key.slice(i + 1)];
}

function keyMatches(key, scope, event) {
  const [kScope, kEvent] = parseKey(key);
  return (kScope === '*' || kScope === scope) && (kEvent === '*' || kEvent === event);
}

function normArgs(a, b, c) {
  if (typeof a === 'function') return ['*', '*', a];
  if (typeof b === 'function') return [a || '*', '*', b];
  if (typeof c !== 'function') throw new TypeError('[Bus] a handler function is required');
  return [a || '*', b || '*', c];
}

export function createBus({ historyLimit = 600, name = 'subkernel' } = {}) {
  const listeners = new Map();
  const rpcHandlers = new Map();
  const loggers = new Set();
  const pending = new Map();
  const history = [];
  const counts = new Map();
  let seq = 0;
  let rpcSeq = 0;
  let dropped = 0;

  function register(map, scope, event, fn) {
    const key = scope + SEP + event;
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(fn);
    return () => {
      const current = map.get(key);
      if (!current || !current.has(fn)) return false;
      current.delete(fn);
      if (!current.size) map.delete(key);
      return true;
    };
  }

  function collect(map, scope, event) {
    const exact = [];
    const wild = [];
    for (const [key, set] of map) {
      if (!keyMatches(key, scope, event)) continue;
      const [kScope, kEvent] = parseKey(key);
      const target = kScope === scope && kEvent === event ? exact : wild;
      for (const fn of set) target.push(fn);
    }
    return exact.concat(wild);
  }

  function record(env) {
    const countKey = env.scope + SEP + env.event;
    counts.set(countKey, (counts.get(countKey) || 0) + 1);
    history.push({ ...env, payload: summarize(env.payload) });
    if (history.length > historyLimit) {
      history.shift();
      dropped++;
    }
    for (const fn of loggers) {
      try {
        fn(env);
      } catch (error) {
        console.error('[Bus] logger failed', error);
      }
    }
  }

  function settle(rpcId, result) {
    const entry = pending.get(rpcId);
    const failed = result && typeof result === 'object' && typeof result.__error === 'string';
    record({
      seq: ++seq,
      scope: 'bus',
      event: RPC_REPLY_EVENT,
      payload: { rpcId, ok: !failed },
      at: Date.now(),
      synthetic: true,
    });
    if (!entry) return;
    pending.delete(rpcId);
    clearTimeout(entry.timer);
    if (failed) entry.reject(new Error(result.__error));
    else entry.resolve(result);
  }

  function emit(scope, event, payload, meta = {}) {
    const env = {
      seq: ++seq,
      scope,
      event,
      payload,
      at: Date.now(),
      app: meta.app || null,
      rpcId: meta.rpcId || null,
      note: meta.note || null,
    };
    record(env);

    const ctx = {
      id: env.seq,
      scope,
      event,
      app: env.app,
      reply: (result) => settle(env.rpcId, result),
    };

    for (const fn of collect(listeners, scope, event)) {
      try {
        fn(payload, ctx);
      } catch (error) {
        console.error(`[Bus] listener for ${scope}:${event} threw`, error);
      }
    }

    if (env.rpcId != null) {
      for (const fn of collect(rpcHandlers, scope, event)) {
        Promise.resolve()
          .then(() => fn(payload, ctx))
          .then((result) => {
            if (result !== undefined) settle(env.rpcId, result);
          })
          .catch((error) => settle(env.rpcId, { __error: String((error && error.message) || error) }));
      }
    }

    return env;
  }

  function call(scope, event, payload = {}, { timeout = 6000, app = null } = {}) {
    return new Promise((resolve, reject) => {
      if (!collect(rpcHandlers, scope, event).length) {
        reject(new Error(`[Bus] no RPC handler for ${scope}:${event}`));
        return;
      }
      const rpcId = `rpc-${++rpcSeq}`;
      const timer = setTimeout(() => {
        pending.delete(rpcId);
        reject(new Error(`[Bus] RPC timeout after ${timeout}ms: ${scope}:${event}`));
      }, timeout);
      pending.set(rpcId, { resolve, reject, timer, scope, event });
      emit(scope, event, payload, { rpcId, app });
    });
  }

  function on(...args) {
    const [scope, event, fn] = normArgs(...args);
    return register(listeners, scope, event, fn);
  }

  function handle(...args) {
    const [scope, event, fn] = normArgs(...args);
    return register(rpcHandlers, scope, event, fn);
  }

  function onLog(fn) {
    loggers.add(fn);
    return () => loggers.delete(fn);
  }

  function waitFor(scope, event, { timeout = 6000 } = {}) {
    return new Promise((resolve, reject) => {
      const off = on(scope, event, (payload, ctx) => {
        clearTimeout(timer);
        off();
        resolve({ payload, ctx });
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error(`[Bus] waitFor timeout: ${scope}:${event}`));
      }, timeout);
    });
  }

  function stats() {
    const byEvent = {};
    for (const [key, value] of counts) {
      const [scope, event] = parseKey(key);
      byEvent[scope + ':' + event] = value;
    }
    return {
      name,
      emitted: seq,
      dropped,
      history: history.length,
      listeners: listeners.size,
      rpcHandlers: rpcHandlers.size,
      byEvent,
    };
  }

  return {
    on,
    off: (scope, event, fn) => {
      const set = listeners.get((scope || '*') + SEP + (event || '*'));
      if (set && fn) set.delete(fn);
    },
    emit,
    onLog,
    handle,
    call,
    waitFor,
    history,
    listeners,
    rpcHandlers,
    stats,
    get listenerCount() {
      let n = 0;
      for (const set of listeners.values()) n += set.size;
      return n;
    },
  };
}
