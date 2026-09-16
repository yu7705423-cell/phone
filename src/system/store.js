import { useState, useEffect } from '../lib.js';

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      if (next === state) return state;
      state = Object.isFrozen(next) ? next : { ...state, ...next };
      subs.forEach(fn => fn(state));
      return state;
    },
    replace(next) { state = next; subs.forEach(fn => fn(state)); return state; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

export function useStore(store) {
  const [v, set] = useState(() => store.get());
  useEffect(() => {
    set(store.get());          // 订阅建立前可能已有变更
    return store.subscribe(set);
  }, [store]);
  return v;
}

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
