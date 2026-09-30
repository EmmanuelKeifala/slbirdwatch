import { File, Paths } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';

import { listSpecies, type BrowseFilters, type Species } from '@/api';
import { packInfo, packSearch } from '@/offlinePack';

// The library's opening page, kept on the phone so the app opens straight onto birds (then refreshes).
const firstPage = () => new File(Paths.cache, 'library-first-page.json');
function readFirstPage(): Species[] {
  try {
    const f = firstPage();
    return f.exists ? (JSON.parse(f.textSync()) as Species[]) : [];
  } catch {
    return [];
  }
}

/** Paged species list for a query + filters (debounced 300 ms); `more()` loads the next page. */
export function useSpecies(query: string, filters: BrowseFilters = {}) {
  const key = JSON.stringify(filters); // stable dependency for the filter object
  const browsing = !query.trim() && key === '{}';
  const [items, setItems] = useState<Species[]>(() => (browsing ? readFirstPage() : []));
  const typed = useRef(false); // the first load runs at once; only typing is debounced
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
      if (offset === 0 && !q && JSON.stringify(filters) === '{}') {
        try {
          firstPage().write(JSON.stringify(page.items));
        } catch {}
      }
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
    const t = setTimeout(() => load(query.trim(), 0), typed.current ? 300 : 0);
    typed.current = true;
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
