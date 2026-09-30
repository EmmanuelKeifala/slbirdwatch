// OBS-10 route helpers, pure for `npm test`.
export type LatLng = [number, number];

/** Metres between two points (haversine). */
function metres(a: LatLng, b: LatLng): number {
  const r = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

export const routeLength = (route: LatLng[]) => route.slice(1).reduce((sum, p, i) => sum + metres(route[i], p), 0);

/** Add a GPS fix unless it's within `minMetres` of the last point or too inaccurate to trust. */
export function addFix(route: LatLng[], fix: LatLng, accuracy: number | null, minMetres = 15): LatLng[] {
  if (accuracy !== null && accuracy > 50) return route;
  const last = route[route.length - 1];
  return last && metres(last, fix) < minMetres ? route : [...route, fix];
}

export const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
export const duration = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
