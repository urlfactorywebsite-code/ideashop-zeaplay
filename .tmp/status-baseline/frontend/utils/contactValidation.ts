import { ContactCreatePayload } from '../types';

export type ContactDraft = Omit<ContactCreatePayload, 'clientLinks'> & {
  clientIds: string[];
  primaryClientId?: string | null;
  primaryClientIds?: string[];
};

export type ContactValidationErrors = Partial<Record<keyof ContactDraft, string>>;

const phonePattern = /^[+0-9][0-9 .()-]{6,49}$/;

export function emptyContactDraft(): ContactDraft {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    title: '',
    notes: '',
    clientIds: [],
    primaryClientId: null,
  };
}

export function normalizeContactDraft(draft: ContactDraft): ContactDraft {
  const clean = (value?: string | null) => {
    const trimmed = (value ?? '').trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  const clientIds = Array.from(new Set(draft.clientIds.filter(Boolean)));
  return {
    firstName: draft.firstName.trim().replace(/\s+/g, ' '),
    lastName: clean(draft.lastName),
    email: clean(draft.email)?.toLowerCase() ?? null,
    phone: clean(draft.phone),
    title: clean(draft.title),
    notes: clean(draft.notes),
    clientIds,
    primaryClientIds: draft.primaryClientIds?.filter(id => clientIds.includes(id)),
    primaryClientId: draft.primaryClientId && clientIds.includes(draft.primaryClientId) ? draft.primaryClientId : null,
  };
}

export function validateContactDraft(draft: ContactDraft): ContactValidationErrors {
  const payload = normalizeContactDraft(draft);
  const errors: ContactValidationErrors = {};

  if (payload.firstName.length < 1) {
    errors.firstName = 'First name is required.';
  }
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (payload.phone && (!phonePattern.test(payload.phone) || payload.phone.replace(/\D/g, '').length < 7)) {
    errors.phone = 'Phone must contain at least 7 digits and valid phone characters.';
  }

  return errors;
}

export function toContactPayload(draft: ContactDraft): ContactCreatePayload {
  const payload = normalizeContactDraft(draft);
  return {
    firstName: payload.firstName,
    lastName: payload.lastName,
    email: payload.email,
    phone: payload.phone,
    title: payload.title,
    notes: payload.notes,
    clientLinks: payload.clientIds.map((clientId) => ({
      clientId,
      isPrimary: payload.primaryClientIds ? payload.primaryClientIds.includes(clientId) : payload.primaryClientId === clientId,
    })),
  };
}
