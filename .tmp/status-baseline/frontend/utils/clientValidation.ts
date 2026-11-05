import { ClientCreatePayload } from '../types';

export type ClientDraft = ClientCreatePayload;

export type ClientValidationErrors = Partial<Record<keyof ClientDraft, string>>;

const phonePattern = /^[+0-9][0-9 .()-]{6,49}$/;
const postalPattern = /^[A-Za-z0-9][A-Za-z0-9 -]{2,31}$/;
const countryPattern = /^[A-Za-z .'-]{2,120}$/;
const hasControlCharacters = /[\u0000-\u001f\u007f]/;

export function emptyClientDraft(): ClientDraft {
  return {
    companyName: '',
    gstNumber: '',
    email: '',
    phone: '',
    website: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
    notes: '',
  };
}

export function normalizeClientPayload(draft: ClientDraft): ClientDraft {
  const clean = (value?: string | null) => {
    const trimmed = (value ?? '').trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  return {
    companyName: draft.companyName.trim().replace(/\s+/g, ' '),
    gstNumber: clean(draft.gstNumber)?.replace(/\s+/g, '').toUpperCase() ?? null,
    email: clean(draft.email),
    phone: clean(draft.phone),
    website: clean(draft.website),
    addressLine1: clean(draft.addressLine1),
    addressLine2: clean(draft.addressLine2),
    city: clean(draft.city),
    state: clean(draft.state),
    postalCode: clean(draft.postalCode),
    country: clean(draft.country),
    notes: clean(draft.notes),
  };
}

export function validateClientDraft(draft: ClientDraft): ClientValidationErrors {
  const payload = normalizeClientPayload(draft);
  const errors: ClientValidationErrors = {};

  if (payload.companyName.length < 2) {
    errors.companyName = 'Company name must be at least 2 characters.';
  }
  if (payload.gstNumber && (!/^[0-9A-Z]{15}$/.test(payload.gstNumber))) {
    errors.gstNumber = 'GST must be a 15-character alphanumeric value.';
  }
  if (payload.phone && (!phonePattern.test(payload.phone) || payload.phone.replace(/\D/g, '').length < 7)) {
    errors.phone = 'Phone must contain at least 7 digits and valid phone characters.';
  }
  if (payload.country && !countryPattern.test(payload.country)) {
    errors.country = 'Country must be a valid country name.';
  }
  if (payload.postalCode && !postalPattern.test(payload.postalCode)) {
    errors.postalCode = 'Postal code must use letters, numbers, spaces or hyphens.';
  }
  if (payload.addressLine1 && payload.addressLine1.length > 255) {
    errors.addressLine1 = 'Address line is too long.';
  }
  if (payload.addressLine1 && hasControlCharacters.test(payload.addressLine1)) {
    errors.addressLine1 = 'Address line contains unsupported characters.';
  }
  if (payload.addressLine2 && payload.addressLine2.length > 255) {
    errors.addressLine2 = 'Address line is too long.';
  }
  if (payload.addressLine2 && hasControlCharacters.test(payload.addressLine2)) {
    errors.addressLine2 = 'Address line contains unsupported characters.';
  }

  return errors;
}
