import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyClientDraft,
  normalizeClientPayload,
  validateClientDraft,
} from '../utils/clientValidation.ts';

test('client validation accepts normalized business inputs', () => {
  const payload = normalizeClientPayload({
    ...emptyClientDraft(),
    companyName: '  Acme   India Pvt Ltd  ',
    gstNumber: '29abcde1234f1z5',
    phone: '+91 98765 43210',
    country: 'India',
    postalCode: '560 001',
  });

  assert.equal(payload.companyName, 'Acme India Pvt Ltd');
  assert.equal(payload.gstNumber, '29ABCDE1234F1Z5');
  assert.deepEqual(validateClientDraft(payload), {});
});

test('client validation rejects unsafe GST, phone, country and postal code inputs', () => {
  const errors = validateClientDraft({
    ...emptyClientDraft(),
    companyName: 'A',
    gstNumber: 'bad',
    phone: '+1 -----',
    country: '1',
    postalCode: '#',
    addressLine1: 'Line\u0007One',
  });

  assert.match(errors.companyName ?? '', /at least 2/);
  assert.match(errors.gstNumber ?? '', /15-character/);
  assert.match(errors.phone ?? '', /at least 7/);
  assert.match(errors.country ?? '', /country name/);
  assert.match(errors.postalCode ?? '', /Postal code/);
  assert.match(errors.addressLine1 ?? '', /unsupported/);
});
