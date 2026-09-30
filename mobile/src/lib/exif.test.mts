// Run: npm test   (Node 22+ strips the types itself)
import assert from 'node:assert/strict';

import { exifDate, exifLocation } from './exif.ts';

// Android: flat tags, decimal magnitudes with refs.
assert.deepEqual(exifLocation({ GPSLatitude: 8.4844, GPSLatitudeRef: 'N', GPSLongitude: 13.2344, GPSLongitudeRef: 'W' }), {
  lat: 8.4844,
  lng: -13.2344,
});
// iOS: nested {GPS} dictionary.
assert.deepEqual(exifLocation({ '{GPS}': { Latitude: 33.9, LatitudeRef: 'S', Longitude: 18.4, LongitudeRef: 'E' } }), {
  lat: -33.9,
  lng: 18.4,
});
// Rational DMS string: 8° 29' 30" N = 8.491666...
const dms = exifLocation({ GPSLatitude: '8/1,29/1,3000/100', GPSLatitudeRef: 'N', GPSLongitude: '13/1,14/1,0/1', GPSLongitudeRef: 'W' });
assert.ok(dms && Math.abs(dms.lat - 8.491667) < 1e-5 && Math.abs(dms.lng + 13.233333) < 1e-5, JSON.stringify(dms));
// Already-signed value with a W ref must not flip back to positive.
assert.equal(exifLocation({ GPSLatitude: 1, GPSLongitude: -13.2, GPSLongitudeRef: 'W' })?.lng, -13.2);
// Missing, junk, out of range and the 0,0 "no fix" placeholder are rejected.
assert.equal(exifLocation(undefined), null);
assert.equal(exifLocation({ GPSLatitude: 'abc', GPSLongitude: 1 }), null);
assert.equal(exifLocation({ GPSLatitude: 91, GPSLongitude: 1 }), null);
assert.equal(exifLocation({ GPSLatitude: 0, GPSLongitude: 0 }), null);

const d = exifDate({ DateTimeOriginal: '2026:09:20 07:15:03' });
assert.ok(d);
assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 8, 20, 7, 15]);
assert.ok(exifDate({ '{Exif}': { DateTimeOriginal: '2025:01:02 03:04:05' } }));
assert.equal(exifDate({ DateTimeOriginal: '0000:00:00 00:00:00' }), null);
assert.equal(exifDate({}), null);

console.log('exif ok');
