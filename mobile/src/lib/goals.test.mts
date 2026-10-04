import assert from 'node:assert/strict';

import { isMilestone, streakGoal } from './goals.ts';

assert.deepEqual(streakGoal(0), { from: 0, to: 3 });
assert.deepEqual(streakGoal(2), { from: 0, to: 3 });
assert.deepEqual(streakGoal(3), { from: 3, to: 7 }); // reaching one starts the next
assert.deepEqual(streakGoal(6), { from: 3, to: 7 });
assert.deepEqual(streakGoal(29), { from: 14, to: 30 });
assert.deepEqual(streakGoal(364), { from: 200, to: 365 });
assert.deepEqual(streakGoal(365), { from: 365, to: 400 }); // past the list: every hundred
assert.deepEqual(streakGoal(400), { from: 365, to: 500 });
assert.ok(isMilestone(7) && isMilestone(30) && !isMilestone(8) && !isMilestone(0));
console.log('goals ok');
