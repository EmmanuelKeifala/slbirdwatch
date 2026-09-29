import assert from 'node:assert/strict';

import { distance, matchName } from './fuzzy.ts';

const crow = ['Pied Crow', 'Corvus albus'];
assert.equal(distance('kitten', 'sitting'), 3);
assert.equal(matchName('pied crow', crow), 'exact');
assert.equal(matchName('  PIED-CROW! ', crow), 'exact');
assert.equal(matchName('piedcrow', crow), 'exact');
assert.equal(matchName('corvus albus', crow), 'exact');
assert.equal(matchName('Pied Krow', crow), 'close'); // one typo
assert.equal(matchName('Hooded Crow', crow), 'wrong');
assert.equal(matchName('crow', crow), 'wrong'); // half a name isn't the name
assert.equal(matchName('pc', crow), 'wrong');
const bee = ['White-throated Bee-eater', 'Merops albicollis'];
assert.equal(matchName('white throated bee eater', bee), 'exact');
assert.equal(matchName('white throated bee eeter', bee), 'close');
assert.equal(matchName('white throated bee', bee), 'wrong');
assert.equal(matchName('Mérops albicolis', bee), 'close'); // accent ignored, one letter missing
console.log('fuzzy: ok');
