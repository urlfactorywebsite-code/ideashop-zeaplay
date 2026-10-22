export type PageAccess = 'allowed' | 'hidden' | 'disabled' | 'forbidden';
export interface NavigationPage {
  id: string; parentId: string | null; defaultLabel: string; route: string;
  navigationLocation: 'sidebar' | 'settings-tab' | 'management-tab' | 'task-tab'; enabled: boolean; hidden: boolean;
  allowedRoles: string[]; permittedRoles: string[]; sortOrder: number;
  isSystemProtected: boolean; access: PageAccess;
}
export interface NavigationDocument {
  revision: number; updatedAt: string | null; updatedBy: string | null;
  canManageGlobal: boolean; canManagePersonal: boolean; roles: string[]; pages: NavigationPage[];
  actorRole: string; oauthManagementAccess: PageAccess; apiSections: { key: string; label: string; access: PageAccess }[];
}
export type NavigationUpdate = { revision: number; pages: Pick<NavigationPage, 'id' | 'enabled' | 'hidden' | 'allowedRoles' | 'sortOrder'>[] };
