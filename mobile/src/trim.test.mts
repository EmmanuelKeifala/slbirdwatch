import assert from 'node:assert/strict';

import { fmt, initialTrim, moveHandle } from './trim.ts';

assert.deepEqual(initialTrim(8), { start: 0, end: 8 });
assert.deepEqual(initialTrim(90), { start: 0, end: 60 });
// Normal moves.
assert.deepEqual(moveHandle({ start: 0, end: 8 }, 'start', 2, 8), { start: 2, end: 8 });
assert.deepEqual(moveHandle({ start: 2, end: 8 }, 'end', 5, 8), { start: 2, end: 5 });
// Can't cross or squeeze below half a second.
assert.deepEqual(moveHandle({ start: 2, end: 5 }, 'start', 6, 8), { start: 4.5, end: 5 });
assert.deepEqual(moveHandle({ start: 2, end: 5 }, 'end', 1, 8), { start: 2, end: 2.5 });
// Stays inside the recording.
assert.deepEqual(moveHandle({ start: 2, end: 5 }, 'start', -3, 8), { start: 0, end: 5 });
assert.deepEqual(moveHandle({ start: 2, end: 5 }, 'end', 99, 8), { start: 2, end: 8 });
// Never longer than 60 s.
assert.deepEqual(moveHandle({ start: 10, end: 60 }, 'end', 90, 120), { start: 10, end: 70 });
assert.deepEqual(moveHandle({ start: 10, end: 70 }, 'start', 0, 120), { start: 10, end: 70 });
assert.equal(fmt(65.25), '1:05.3');

console.log('trim ok');
