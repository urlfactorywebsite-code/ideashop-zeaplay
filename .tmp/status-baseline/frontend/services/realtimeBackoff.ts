export type RealtimeReconnectPolicy = {
  minDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  maxAttempts?: number;
};

export const DEFAULT_REALTIME_RECONNECT_POLICY: Required<RealtimeReconnectPolicy> = {
  minDelayMs: 1000,
  maxDelayMs: 30000,
  jitterRatio: 0.35,
  maxAttempts: Number.POSITIVE_INFINITY,
};

const normalizePolicy = (policy: RealtimeReconnectPolicy = {}): Required<RealtimeReconnectPolicy> => ({
  minDelayMs: Math.max(0, policy.minDelayMs ?? DEFAULT_REALTIME_RECONNECT_POLICY.minDelayMs),
  maxDelayMs: Math.max(
    policy.minDelayMs ?? DEFAULT_REALTIME_RECONNECT_POLICY.minDelayMs,
    policy.maxDelayMs ?? DEFAULT_REALTIME_RECONNECT_POLICY.maxDelayMs,
  ),
  jitterRatio: Math.max(0, Math.min(1, policy.jitterRatio ?? DEFAULT_REALTIME_RECONNECT_POLICY.jitterRatio)),
  maxAttempts: policy.maxAttempts ?? DEFAULT_REALTIME_RECONNECT_POLICY.maxAttempts,
});

export const calculateReconnectDelay = (
  attempt: number,
  policy: RealtimeReconnectPolicy = {},
  random: () => number = Math.random,
): number => {
  const normalized = normalizePolicy(policy);
  const exponential = normalized.minDelayMs * 2 ** Math.max(0, attempt);
  const capped = Math.min(exponential, normalized.maxDelayMs);
  const jitterWindow = capped * normalized.jitterRatio;
  const jitter = (random() * 2 - 1) * jitterWindow;
  return Math.max(0, Math.round(capped + jitter));
};

export const isBrowserOnline = (): boolean => (
  typeof navigator === 'undefined' || navigator.onLine !== false
);

export class RealtimeReconnectController {
  private timer: number | null = null;
  private onlineHandler: (() => void) | null = null;
  private attempt = 0;
  private cancelled = false;
  private readonly policy: Required<RealtimeReconnectPolicy>;

  constructor(policy: RealtimeReconnectPolicy = {}) {
    this.policy = normalizePolicy(policy);
  }

  reset(): void {
    this.attempt = 0;
  }

  private clearOnlineHandler(): void {
    if (this.onlineHandler && typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineHandler);
    }
    this.onlineHandler = null;
  }

  cancel(): void {
    this.cancelled = true;
    if (this.timer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.timer);
    }
    this.timer = null;
    this.clearOnlineHandler();
  }

  activate(): void {
    this.cancelled = false;
  }

  schedule(callback: () => void): void {
    if (this.cancelled || this.attempt >= this.policy.maxAttempts || typeof window === 'undefined') {
      return;
    }
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.clearOnlineHandler();
    if (!isBrowserOnline()) {
      this.onlineHandler = () => {
        if (this.cancelled) return;
        this.onlineHandler = null;
        callback();
      };
      window.addEventListener('online', this.onlineHandler, { once: true });
      return;
    }
    const delay = calculateReconnectDelay(this.attempt, this.policy);
    this.attempt += 1;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (!this.cancelled) {
        callback();
      }
    }, delay);
  }
}
