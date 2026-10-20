import { Role, type Task, type User } from '../types';

export function taskPermissions(task: Task | null, user: User | null) {
  if (!task || !user) return { canEdit: false, canManageSubtasks: false, canReviewSubtasks: false };
  const legacyManager = [Role.MANAGER, Role.ADMIN, Role.OWNER].includes(user.role);
  const legacyWorkflow = legacyManager || (!task.projectId && !task.project && task.createdBy === user.id);
  return {
    canEdit: task.canEdit ?? (legacyManager || task.createdBy === user.id || Boolean(task.assignedTo?.includes(user.id))),
    canManageSubtasks: task.canManageSubtasks ?? legacyWorkflow,
    canReviewSubtasks: task.canReviewSubtasks ?? legacyWorkflow,
  };
}
