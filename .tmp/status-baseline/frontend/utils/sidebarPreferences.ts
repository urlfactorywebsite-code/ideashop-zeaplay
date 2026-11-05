export type SidebarPreferences = { order: string[]; labels: Record<string, string> };

export const emptySidebarPreferences = (): SidebarPreferences => ({ order: [], labels: {} });

export function sidebarStorageKey(tenantId: string | null | undefined, userId: string) {
  return `zea.sidebar.v1:${encodeURIComponent(tenantId || 'default')}:${encodeURIComponent(userId)}`;
}

export function parseSidebarPreferences(raw: string | null): SidebarPreferences {
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || typeof value !== 'object') return emptySidebarPreferences();
    const order = Array.isArray(value.order)
      ? [...new Set(value.order.filter((key: unknown): key is string => typeof key === 'string'))] as string[] : [];
    const labels: Record<string, string> = Object.create(null);
    if (value.labels && typeof value.labels === 'object' && !Array.isArray(value.labels)) {
      for (const [key, label] of Object.entries(value.labels)) {
        if (typeof label === 'string' && label.trim() && label.trim().length <= 48) labels[key] = label.trim();
      }
    }
    return { order, labels };
  } catch {
    return emptySidebarPreferences();
  }
}

export function applySidebarPreferences<T extends { label: string }>(
  links: T[], keyOf: (link: T) => string, preferences: SidebarPreferences,
): T[] {
  const byKey = new Map(links.map(link => [keyOf(link), link]));
  const keys = [...new Set([...preferences.order, ...byKey.keys()])];
  return keys.filter(key => byKey.has(key)).map(key => {
    const link = byKey.get(key)!;
    return { ...link, label: preferences.labels[key] || link.label };
  });
}
