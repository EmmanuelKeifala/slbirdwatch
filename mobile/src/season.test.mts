import assert from 'node:assert/strict';

import { seasonText } from './season.ts';

const m = (...on: number[]) => Array.from({ length: 12 }, (_, i) => (on.includes(i + 1) ? 5 : 0));
assert.deepEqual(seasonText(m(11, 12, 1, 2, 3, 4)), { title: 'Nov–Apr', caption: 'Seasonal visitor' });
assert.deepEqual(seasonText(m(5, 6, 7, 9)), { title: 'May–Jul', caption: 'Mostly; a few other months too' });
assert.equal(seasonText(m(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)).title, 'Year-round');
assert.equal(seasonText(m(3)).title, 'Mar');
assert.equal(seasonText([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]).title, 'Rarely recorded');
console.log('season ok');
