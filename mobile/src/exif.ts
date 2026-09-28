// Reads capture time and GPS from expo-image-picker's `asset.exif`.
// iOS nests GPS under "{GPS}" (and sometimes dates under "{Exif}"); Android uses flat EXIF tag names.
// Values may be decimal numbers, numeric strings, or rational DMS strings like "8/1,29/1,3000/100".

type Exif = Record<string, unknown> | null | undefined;

function nested(exif: Exif, dict: string, key: string): unknown {
  const d = exif?.[dict];
  return d && typeof d === 'object' ? (d as Record<string, unknown>)[key] : undefined;
}

function toDegrees(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  if (!v.includes('/')) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const parts = v.split(',').map((p) => {
    const [num, den] = p.split('/').map(Number);
    return den ? num / den : NaN;
  });
  if (parts.some((p) => !Number.isFinite(p))) return null;
  const [d = 0, m = 0, s = 0] = parts;
  return d + m / 60 + s / 3600;
}

export function exifLocation(exif: Exif): { lat: number; lng: number } | null {
  const lat = toDegrees(exif?.GPSLatitude ?? nested(exif, '{GPS}', 'Latitude'));
  const lng = toDegrees(exif?.GPSLongitude ?? nested(exif, '{GPS}', 'Longitude'));
  if (lat === null || lng === null) return null;
  const latRef = String(exif?.GPSLatitudeRef ?? nested(exif, '{GPS}', 'LatitudeRef') ?? 'N').toUpperCase();
  const lngRef = String(exif?.GPSLongitudeRef ?? nested(exif, '{GPS}', 'LongitudeRef') ?? 'E').toUpperCase();
  // Some platforms already sign the value; only apply the ref to positive magnitudes.
  const signedLat = latRef === 'S' ? -Math.abs(lat) : lat;
  const signedLng = lngRef === 'W' ? -Math.abs(lng) : lng;
  if (Math.abs(signedLat) > 90 || Math.abs(signedLng) > 180 || (signedLat === 0 && signedLng === 0)) return null;
  return { lat: signedLat, lng: signedLng };
}

/** EXIF "YYYY:MM:DD HH:MM:SS" is local camera time with no zone; interpret it in the phone's zone. */
export function exifDate(exif: Exif): Date | null {
  const raw = exif?.DateTimeOriginal ?? nested(exif, '{Exif}', 'DateTimeOriginal') ?? exif?.DateTime;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) || y < 1900 ? null : date;
}
