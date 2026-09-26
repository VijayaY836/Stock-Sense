import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** Load data from the API; re-runs when `deps` change. Returns { data, error, loading, reload }. */
export function useApi(path, params, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const key = JSON.stringify([path, params]);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api.get(path, params);
      if (n === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (n === seq.current) setState({ data: null, error, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

const EMPTY = Object.freeze([]); // stable reference so effects don't re-run while loading

/** Shared lookups used by many forms and filters */
export function useLookups() {
  const warehouses = useApi('/warehouses');
  const locations = useApi('/locations');
  const categories = useApi('/categories');
  return {
    warehouses: warehouses.data ?? EMPTY,
    locations: locations.data ?? EMPTY,
    categories: categories.data ?? EMPTY,
    reload: () => { warehouses.reload(); locations.reload(); categories.reload(); },
  };
}
