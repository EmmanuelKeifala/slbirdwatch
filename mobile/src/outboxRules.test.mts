import assert from 'node:assert/strict';

import { backoffMs, classify } from './outboxRules.ts';

assert.equal(classify(new TypeError('Network request failed')), 'offline');
assert.equal(classify({ status: 401 }), 'auth');
assert.equal(classify({ status: 503 }), 'retry');
assert.equal(classify({ status: 429 }), 'retry');
assert.equal(classify({ status: 400 }), 'fatal');
assert.equal(classify({ status: 403 }), 'fatal');
assert.equal(backoffMs(1), 30_000);
assert.equal(backoffMs(3), 120_000);
assert.equal(backoffMs(20), 3_600_000);
console.log('outbox ok');
