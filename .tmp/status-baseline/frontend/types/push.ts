export type PushDevice = {
  id: string;
  endpointHash: string;
  deviceLabel: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

export type PushServerStatus = {
  configured: boolean;
  publicKeyConfigured: boolean;
  privateKeyConfigured: boolean;
  subjectConfigured: boolean;
  configurationValid: boolean;
  activeSubscriptionCount: number;
};

export type PushTestResult = {
  accepted: number;
  attempted: number;
  failed: number;
  revoked: number;
};
