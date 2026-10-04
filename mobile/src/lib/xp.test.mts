import assert from 'node:assert/strict';

import { xpGained } from './xp.ts';

assert.equal(xpGained(7, 7, 50), 7); // first round of the day
assert.equal(xpGained(20, 8, 50), 8); // well under the cap
assert.equal(xpGained(53, 8, 50), 5); // straddles the cap: 45 → 50
assert.equal(xpGained(60, 8, 50), 0); // already past it
assert.equal(xpGained(0, 0, 50), 0); // nothing right
assert.equal(xpGained(4, 4, 50, 2), 8); // points per answer
assert.equal(xpGained(3, 5, 50), 3); // today's count behind the round (late sync): never negative, never more than today
console.log('xp ok');
