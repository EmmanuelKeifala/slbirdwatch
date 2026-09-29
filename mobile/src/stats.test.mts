import assert from 'node:assert/strict';

import { accuracy, applyQuiz, emptyStats, mastered, mergeStats, quizDelta } from './stats.ts';

const s1 = applyQuiz(emptyStats, [
  { speciesId: 1, correct: true },
  { speciesId: 2, correct: true },
  { speciesId: 3, correct: false },
  { speciesId: 4, correct: true },
]);
assert.deepEqual([s1.quizzes, s1.answered, s1.correct, s1.bestStreak], [1, 4, 3, 2]);
assert.deepEqual(s1.missed, { '3': 1 });
assert.equal(accuracy(s1), 75);

// Getting a missed bird right later reduces, then clears, its miss count; streak never goes down.
const s2 = applyQuiz(s1, [{ speciesId: 3, correct: true }]);
assert.deepEqual(s2.missed, {});
assert.equal(s2.bestStreak, 2);
assert.equal(accuracy(emptyStats), 0);

// The miss list is capped.
const many = Array.from({ length: 400 }, (_, i) => ({ speciesId: i, correct: false }));
assert.equal(Object.keys(applyQuiz(emptyStats, many).missed).length, 300);

// Offline changes keep negatives until they reach the server, where they cancel stored misses.
const pending = mergeStats(emptyStats, quizDelta([{ speciesId: 9, correct: true }]), true);
assert.deepEqual(pending.missed, { '9': -1 });
const server = { ...emptyStats, missed: { '9': 2 } };
assert.deepEqual(mergeStats(server, pending).missed, { '9': 1 });
assert.deepEqual(mergeStats(emptyStats, pending).missed, {}); // shown totals never go negative

// LRN-06: per bird and per kind.
const d = quizDelta(
  [
    { speciesId: 5, correct: true },
    { speciesId: 5, correct: true },
    { speciesId: 6, correct: false },
  ],
  'sound',
);
assert.deepEqual(d.bySpecies, { '5': [2, 0], '6': [0, 1] });
assert.deepEqual(d.byKind, { sound: [2, 1] });
const both = mergeStats(d, quizDelta([{ speciesId: 5, correct: true }], 'picture'));
assert.deepEqual(both.bySpecies?.['5'], [3, 0]);
assert.deepEqual(both.byKind, { sound: [2, 1], picture: [1, 0] });
assert.equal(mastered([3, 0]), true);
assert.equal(mastered([3, 1]), false); // 75%
assert.equal(mastered([2, 0]), false);

console.log('stats ok');
