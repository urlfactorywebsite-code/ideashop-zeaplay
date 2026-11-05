import { ProjectCreatePayload, ProjectUpdatePayload } from '../types';

export type ProjectDraft = {
  name: string;
  clientId: string;
  description: string;
  startDate: string;
  endDate: string;
  managerIds: string[];
  memberIds: string[];
  subtaskApprovalRequiredDefault: boolean;
};

export type ProjectValidationErrors = Partial<Record<keyof ProjectDraft | 'dates', string>>;

export const normalizeProjectIds = (ids: string[]): string[] => {
  const seen = new Set<string>();
  return ids
    .map((id) => id.trim())
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
};

export function validateProjectDraft(draft: ProjectDraft): ProjectValidationErrors {
  const errors: ProjectValidationErrors = {};
  if (draft.name.trim().length < 2) {
    errors.name = 'Project name must be at least 2 characters.';
  }
  if (!draft.clientId.trim()) {
    errors.clientId = 'Select a client.';
  }
  if (normalizeProjectIds(draft.managerIds).length === 0) {
    errors.managerIds = 'Select at least one project manager.';
  }
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.dates = 'End date cannot be before start date.';
  }
  return errors;
}

export function toProjectPayload(draft: ProjectDraft): ProjectCreatePayload | ProjectUpdatePayload {
  const managerIds = normalizeProjectIds(draft.managerIds);
  const memberIds = normalizeProjectIds(draft.memberIds).filter((id) => !managerIds.includes(id));
  return {
    name: draft.name.trim(),
    clientId: draft.clientId.trim(),
    description: draft.description.trim() || null,
    startDate: draft.startDate || null,
    endDate: draft.endDate || null,
    managerIds,
    memberIds,
    ...(draft.subtaskApprovalRequiredDefault !== undefined
      ? { subtaskApprovalRequiredDefault: draft.subtaskApprovalRequiredDefault }
      : {}),
  };
}
