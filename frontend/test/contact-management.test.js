import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyContactDraft,
  normalizeContactDraft,
  toContactPayload,
  validateContactDraft,
} from '../utils/contactValidation.ts';

test('contact validation normalizes identity and client links', () => {
  const draft = normalizeContactDraft({
    ...emptyContactDraft(),
    firstName: '  Priya  ',
    lastName: '  Shah ',
    email: 'PRIYA@EXAMPLE.COM',
    phone: '+91 98765 43210',
    clientIds: ['client-a', 'client-a', 'client-b'],
    primaryClientId: 'client-b',
  });

  assert.equal(draft.firstName, 'Priya');
  assert.equal(draft.lastName, 'Shah');
  assert.equal(draft.email, 'priya@example.com');
  assert.deepEqual(draft.clientIds, ['client-a', 'client-b']);
  assert.deepEqual(validateContactDraft(draft), {});

  const payload = toContactPayload(draft);
  assert.deepEqual(payload.clientLinks, [
    { clientId: 'client-a', isPrimary: false },
    { clientId: 'client-b', isPrimary: true },
  ]);
});

test('contact validation rejects bad email and weak phone', () => {
  const errors = validateContactDraft({
    ...emptyContactDraft(),
    firstName: '',
    email: 'not-email',
    phone: '+1 ----',
  });

  assert.match(errors.firstName ?? '', /required/);
  assert.match(errors.email ?? '', /valid email/);
  assert.match(errors.phone ?? '', /at least 7/);
});

test('editing preserves primary flags on every linked client, including archived relationships', () => {
  const draft = { ...emptyContactDraft(), firstName: 'Priya', clientIds: ['active', 'archived', 'another'],
    primaryClientId: 'active', primaryClientIds: ['active', 'archived'] };
  assert.deepEqual(toContactPayload(draft).clientLinks, [
    { clientId: 'active', isPrimary: true },
    { clientId: 'archived', isPrimary: true },
    { clientId: 'another', isPrimary: false },
  ]);
  assert.deepEqual(toContactPayload({ ...draft, clientIds: ['active', 'another'] }).clientLinks, [
    { clientId: 'active', isPrimary: true }, { clientId: 'another', isPrimary: false },
  ]);
});
