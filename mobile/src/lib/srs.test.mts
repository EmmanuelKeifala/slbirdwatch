import assert from 'node:assert/strict';

import { dueCards, newCard, nextLabel, review } from './srs.ts';

const now = 1_000_000_000_000;
const DAY = 86_400_000;
let c = newCard(7, now);
assert.equal(dueCards([c], now).length, 1);
c = review(c, 'good', now); // first right answer: tomorrow
assert.equal(c.interval, 1);
assert.equal(c.due, now + DAY);
c = review(c, 'good', c.due); // second: 6 days
assert.equal(c.interval, 6);
c = review(c, 'good', c.due); // then × ease (~2.5)
assert.equal(c.interval, 15);
const lapse = review(c, 'again', c.due); // a miss: back in 10 minutes, starts over, ease drops
assert.equal(lapse.reps, 0);
assert.equal(lapse.due - c.due, 10 * 60_000);
assert.ok(lapse.ease < c.ease && lapse.ease >= 1.3);
assert.ok(review(c, 'easy', c.due).interval > review(c, 'good', c.due).interval);
assert.equal(nextLabel(newCard(1, now), 'again', now), '10 min');
assert.equal(nextLabel(newCard(1, now), 'good', now), '1 d');
assert.equal(dueCards([c], now).length, 0);
console.log('srs ok');
