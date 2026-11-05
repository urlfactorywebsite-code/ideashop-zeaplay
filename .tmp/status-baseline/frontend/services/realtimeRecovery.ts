export class RecentEventIds {
  private ids = new Set<string>();
  accept(id?: string): boolean {
    if (!id) return true;
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > 4096) this.ids.delete(this.ids.values().next().value!);
    return true;
  }
}

export class CoalescedReconciliation {
  private running = false;
  private requested = false;
  private cancelled = false;

  constructor(private readonly reconcile: () => Promise<void>) {}

  async request(): Promise<void> {
    if (this.cancelled) return;
    this.requested = true;
    if (this.running) return;
    this.running = true;
    try {
      while (this.requested && !this.cancelled) {
        this.requested = false;
        await this.reconcile();
      }
    } finally {
      this.running = false;
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.requested = false;
  }
}

const persistedTime = (value: string): number => {
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : 0;
};

export const comparePersistedTimes = (left: string, right: string): number => persistedTime(left) - persistedTime(right);

export const mergeRecoveredMessages = <T extends { id: string; clientId?: string | null; createdAt: string }>(
  snapshot: T[], buffered: T[], optimistic: T[] = [],
): T[] => {
  const byId = new Map<string, T>();
  const clientIds = new Map<string, string>();
  for (const message of [...optimistic, ...snapshot, ...buffered]) {
    const optimisticId = message.clientId ? clientIds.get(message.clientId) : undefined;
    if (optimisticId) byId.delete(optimisticId);
    byId.set(message.id, message);
    if (message.clientId) clientIds.set(message.clientId, message.id);
  }
  return [...byId.values()].sort((a, b) => comparePersistedTimes(a.createdAt, b.createdAt) || a.id.localeCompare(b.id));
};
