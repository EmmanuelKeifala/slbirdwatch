import assert from 'node:assert/strict';

import { addFix, duration, km, routeLength } from './outingMath.ts';

const r = routeLength([[8.47, -13.23], [8.48, -13.23]]); // 0.01° of latitude
assert.ok(r > 1100 && r < 1120, `length ${r}`);
let route = addFix([], [8.47, -13.23], 5);
route = addFix(route, [8.47001, -13.23], 5); // ~1 m: skipped
route = addFix(route, [8.4702, -13.23], 80); // too inaccurate: skipped
route = addFix(route, [8.4702, -13.23], 10); // ~22 m: kept
assert.equal(route.length, 2);
assert.equal(km(850), '850 m');
assert.equal(km(3240), '3.2 km');
assert.equal(duration(45), '45 min');
assert.equal(duration(125), '2 h 05 min');
console.log('outing ok');
