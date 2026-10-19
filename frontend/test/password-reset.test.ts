import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordError } from '../utils/passwordReset';

test('password reset validation agrees with server character and UTF-8 byte limits', () => {
    assert.equal(passwordError('abcdefgh', 'abcdefgh'), null);
    assert.match(passwordError('abc123', 'abc123')!, /at least 8/);
    assert.match(passwordError('abcdefgh', 'different')!, /do not match/);
    assert.match(passwordError('x'.repeat(73), 'x'.repeat(73))!, /72 UTF-8/);
    assert.match(passwordError('\u20ac'.repeat(25), '\u20ac'.repeat(25))!, /72 UTF-8/);
    assert.equal(passwordError('\u{1f511}'.repeat(8), '\u{1f511}'.repeat(8)), null);
});
