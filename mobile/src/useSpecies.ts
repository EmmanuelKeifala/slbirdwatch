import { useEffect, useRef, useState } from 'react';

import { listSpecies, type BrowseFilters, type Species } from '@/api';
import { packInfo, packSearch } from '@/offlinePack';

/** Paged species list for a query + filters (debounced 300 ms); `more()` loads the next page. */
export function useSpecies(query: string, filters: BrowseFilters = {}) {
  const key = JSON.stringify(filters); // stable dependency for the filter object
  const [items, setItems] = useState<Species[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [offline, setOffline] = useState(false);

  async function load(q: string, offset: number) {
    abort.current?.abort();
    const ctrl = (abort.current = new AbortController());
    setLoading(true);
    setError(null);
    try {
      const page = await listSpecies({ q, offset, ...filters }, ctrl.signal);
      setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
      setOffline(false);
      setNext(page.next_offset);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      // LIB-11: no signal, but the offline guide is on the phone (filters need the server, so they're ignored)
      if (packInfo() && offset === 0) {
        setItems(packSearch(q));
        setNext(null);
        setOffline(true);
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(query.trim(), 0), 300);
    return () => clearTimeout(t);
    // `key` stands in for `filters`; `load` is recreated each render and reads the latest values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, key]);

  return {
    items,
    offline,
    loading,
    error,
    more: () => next !== null && !loading && !error && load(query.trim(), next),
    retry: () => load(query.trim(), items.length ? (next ?? 0) : 0),
  };
}
