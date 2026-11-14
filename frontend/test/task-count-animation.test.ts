import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNT_ROLL_SECONDS, countStagger, planCountReel, validTaskCount } from '../utils/taskCountAnimation';

test('count animation accepts real nonnegative integer counts without converting missing data to zero', () => {
  for (const count of [0, 9, 10, 99, 100, 1000, Number.MAX_SAFE_INTEGER]) assert.ok(validTaskCount(count));
  for (const count of [null, undefined, '9', -1, .5, Infinity, NaN]) assert.equal(validTaskCount(count), false);
});
test('initial and large-value animations are bounded to a small number of rows and about one second', () => {
  for (let digit = 0; digit < 10; digit++) {
    const { start, target } = planCountReel(10, digit, 1, true);
    assert.equal(start, 10); assert.ok(target < 30); assert.equal(target % 10, digit);
  }
  assert.ok(COUNT_ROLL_SECONDS + countStagger(1000) <= 1.1);
  assert.equal(countStagger(0), 0); assert.equal(countStagger(1000), .08);
});
test('retargeting preserves the fractional visual position and rolls in the new direction', () => {
  const forward = planCountReel(28.5, 2, 1, false);
  assert.deepEqual(forward, { start: 18.5, target: 22 });
  assert.deepEqual(planCountReel(28.5, 2, -1, false), { start: 18.5, target: 12 });
  assert.deepEqual(planCountReel(10.5, 9, -1, false), { start: 10.5, target: 9 });
  assert.deepEqual(planCountReel(19, 9, 1, false), { start: 19, target: 19 });
});
test('zero and unchanged digits do not require a full revolution', () => {
  assert.deepEqual(planCountReel(10, 0, 1, true), { start: 10, target: 10 });
  assert.deepEqual(planCountReel(14, 4, 1, false), { start: 14, target: 14 });
});
