import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArchiveIcon,
  CloudIcon,
  DatabaseIcon,
  HardDriveIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldCheckIcon,
} from 'lucide-react';

import api from '../services/api';
import { MediaProviderStatus, Role, StorageProvider } from '../types';

type StatusTone = 'connected' | 'warning' | 'error' | 'neutral';

type StorageOption = {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  statusLabel: string;
  statusTone: StatusTone;
  tags: string[];
  config: string[];
  provider?: StorageProvider;
  action?: React.ReactNode;
  details?: string;
};

const LIVE_PROVIDERS: StorageProvider[] = ['supabase', 'gdrive'];
const GOOGLE_DRIVE_OAUTH_MESSAGE_TYPE = 'zea-play:gdrive-oauth';

const toneClasses: Record<StatusTone, string> = {
  connected: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  error: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  neutral: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

const providerStatusTone = (status?: MediaProviderStatus): StatusTone => {
  if (!status) return 'neutral';
  if (status.status === 'connected') return 'connected';
  if (status.status === 'missing_env') return 'warning';
  return 'error';
};

const providerStatusLabel = (status?: MediaProviderStatus, fallback = 'Not checked'): string => {
  if (!status) return fallback;
  if (status.status === 'connected') return 'Connected';
  if (status.status === 'missing_env') return 'Missing config';
  return 'Connection error';
};

type SettingsStorageOptionsPanelProps = {
  userRole?: Role;
};

const SettingsStorageOptionsPanel: React.FC<SettingsStorageOptionsPanelProps> = ({ userRole }) => {
  const canManageStorage = userRole === Role.OWNER || userRole === Role.ADMIN;
  const [statuses, setStatuses] = useState<Partial<Record<StorageProvider, MediaProviderStatus>>>({});
  const [busyProvider, setBusyProvider] = useState<StorageProvider | null>(null);

  const checkProvider = useCallback(
    async (provider: StorageProvider) => {
      if (!canManageStorage) {
        return;
      }
      setBusyProvider(provider);
      try {
        const status = await api.connectMediaProvider(provider);
        setStatuses((prev) => ({ ...prev, [provider]: status }));
      } catch (error) {
        setStatuses((prev) => ({
          ...prev,
          [provider]: {
            provider,
            status: 'error',
            details: error instanceof Error ? error.message : 'Unable to check provider status',
          },
        }));
      } finally {
        setBusyProvider((current) => (current === provider ? null : current));
      }
    },
    [canManageStorage],
  );

  useEffect(() => {
    if (!canManageStorage) {
      return;
    }
    LIVE_PROVIDERS.forEach((provider) => {
      void checkProvider(provider);
    });
  }, [canManageStorage, checkProvider]);

  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string; status?: string; message?: string } | undefined;
      if (!payload || payload.type !== GOOGLE_DRIVE_OAUTH_MESSAGE_TYPE) {
        return;
      }
      if (payload.status === 'connected') {
        void checkProvider('gdrive');
        return;
      }
      setStatuses((prev) => ({
        ...prev,
        gdrive: {
          provider: 'gdrive',
          status: 'error',
          details: payload.message || 'Google Drive authorization did not complete.',
        },
      }));
    };
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [checkProvider]);

  const connectProvider = useCallback(
    async (provider: StorageProvider, currentStatus?: MediaProviderStatus) => {
      if (!canManageStorage) {
        return;
      }
      if (provider !== 'gdrive' || currentStatus?.status === 'connected') {
        await checkProvider(provider);
        return;
      }
      setBusyProvider(provider);
      try {
        const response = await api.startGoogleDriveOAuth();
        const popup = window.open(
          response.authorizationUrl,
          'zea-play-google-drive-oauth',
          'popup=yes,width=560,height=720,menubar=no,toolbar=no,location=yes,status=no,scrollbars=yes,resizable=yes',
        );
        if (!popup) {
          setStatuses((prev) => ({
            ...prev,
            gdrive: {
              provider: 'gdrive',
              status: 'error',
              details: 'Popup blocked. Allow popups for this site and click Connect again.',
            },
          }));
        }
      } catch (error) {
        setStatuses((prev) => ({
          ...prev,
          gdrive: {
            provider: 'gdrive',
            status: 'error',
            details: error instanceof Error ? error.message : 'Unable to start Google Drive authorization.',
          },
        }));
      } finally {
        setBusyProvider((current) => (current === provider ? null : current));
      }
    },
    [canManageStorage, checkProvider],
  );

  const options = useMemo<StorageOption[]>(() => {
    const supabaseStatus = statuses.supabase;
    const driveStatus = statuses.gdrive;

    return [
      {
        id: 'minio',
        title: 'MinIO storage',
        description: 'Sync test images, ZIPs, documents, PDFs and other Media Library files through presigned uploads.',
        icon: <ServerIcon className="h-5 w-5 text-cyan-300" />,
        statusLabel: 'Active media path',
        statusTone: 'connected',
        tags: ['Images', 'ZIP', 'Docs', 'PDF', 'Other files'],
        config: ['VEE_MINIO_ENDPOINT', 'VEE_MINIO_ACCESS_KEY', 'VEE_MINIO_SECRET_KEY', 'VEE_MINIO_BUCKET_ATTACHMENTS'],
        action: (
          <Link
            to="/settings/media-library"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
          >
            Sync test
          </Link>
        ),
      },
      {
        id: 'gdrive',
        title: 'Google Drive',
        description: 'Open a Google sign-in popup from Settings for shared drive or service-account storage checks.',
        icon: <DatabaseIcon className="h-5 w-5 text-sky-300" />,
        statusLabel: canManageStorage ? providerStatusLabel(driveStatus) : 'Admin only',
        statusTone: canManageStorage ? providerStatusTone(driveStatus) : 'neutral',
        tags: ['Google login popup', 'Shared drives', 'Service account'],
        config: ['VEE_GOOGLE_CLIENT_ID', 'VEE_GOOGLE_CLIENT_SECRET', 'VEE_GOOGLE_DRIVE_FOLDER_ID', 'VEE_GOOGLE_REDIRECT_URI'],
        provider: 'gdrive',
        details: driveStatus?.details,
      },
      {
        id: 'supabase',
        title: 'Supabase Storage',
        description: 'Configure Supabase bucket access for signed URLs, CDN-friendly reads and managed object storage.',
        icon: <CloudIcon className="h-5 w-5 text-emerald-300" />,
        statusLabel: canManageStorage ? providerStatusLabel(supabaseStatus) : 'Admin only',
        statusTone: canManageStorage ? providerStatusTone(supabaseStatus) : 'neutral',
        tags: ['Signed URLs', 'CDN', 'Bucket config'],
        config: ['VEE_SUPABASE_URL', 'VEE_SUPABASE_BUCKET', 'VEE_SUPABASE_SERVICE_ROLE_KEY', 'VEE_SUPABASE_PUBLIC_URL'],
        provider: 'supabase',
        details: supabaseStatus?.details,
      },
      {
        id: 'onedrive',
        title: 'OneDrive',
        description: 'Microsoft Graph storage option for teams that prefer OneDrive or SharePoint-backed files.',
        icon: <HardDriveIcon className="h-5 w-5 text-blue-300" />,
        statusLabel: 'Provider planned',
        statusTone: 'neutral',
        tags: ['OneDrive', 'SharePoint', 'Microsoft Graph'],
        config: ['VEE_MICROSOFT_CLIENT_ID', 'VEE_MICROSOFT_CLIENT_SECRET', 'VEE_MICROSOFT_TENANT_ID'],
        action: (
          <button
            type="button"
            disabled
            className="inline-flex items-center justify-center rounded-lg border border-border-color px-3 py-2 text-xs font-semibold text-text-secondary opacity-70"
          >
            Coming soon
          </button>
        ),
      },
      {
        id: 'local-private',
        title: 'Private local evidence storage',
        description: 'Task proof screenshots, documents, PDFs and approval attachments stay private on the server media root.',
        icon: <ShieldCheckIcon className="h-5 w-5 text-purple-300" />,
        statusLabel: 'Built in',
        statusTone: 'connected',
        tags: ['Task proof', 'Screenshots', 'Documents', 'Private download'],
        config: ['VEE_MEDIA_ROOT', 'VEE_MAX_REQUEST_BODY_MB'],
      },
      {
        id: 'open-source',
        title: 'S3-compatible free options',
        description: 'Open-source alternatives such as Garage, SeaweedFS or LocalStack S3 can follow the MinIO-compatible path.',
        icon: <ArchiveIcon className="h-5 w-5 text-amber-300" />,
        statusLabel: 'Compatible path',
        statusTone: 'warning',
        tags: ['Free', 'Open source', 'S3 API'],
        config: ['VEE_S3_ENDPOINT', 'VEE_S3_ACCESS_KEY', 'VEE_S3_SECRET_KEY', 'VEE_S3_BUCKET'],
      },
    ];
  }, [canManageStorage, statuses.gdrive, statuses.supabase]);

  return (
    <section className="rounded-xl border border-border-color bg-surface p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Storage options</p>
          <h2 className="text-lg font-semibold text-text-primary">Storage providers</h2>
          <p className="max-w-3xl text-sm text-text-secondary">
            Manage where media, proof files and approval attachments can be stored. Live checks use existing backend storage adapters.
          </p>
        </div>
        <div className="rounded-full border border-border-color bg-muted px-3 py-1 text-xs font-semibold text-text-secondary">
          Images, ZIP, docs, PDF, other files
        </div>
      </div>

      {!canManageStorage && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Owner or Admin access is required to connect or test external storage providers.
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {options.map((option) => {
          const isBusy = option.provider && busyProvider === option.provider;
          return (
            <article
              key={option.id}
              className="flex min-h-[220px] flex-col justify-between rounded-xl border border-border-color bg-background/70 p-5"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-muted p-3">{option.icon}</div>
                    <div>
                      <h3 className="text-base font-semibold text-text-primary">{option.title}</h3>
                      <p className="mt-1 text-sm text-text-secondary">{option.description}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${toneClasses[option.statusTone]}`}>
                    {option.statusLabel}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {option.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-border-color bg-muted px-2.5 py-1 text-xs text-text-secondary">
                      {tag}
                    </span>
                  ))}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Config</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {option.config.map((item) => (
                      <code key={item} className="rounded-md border border-border-color bg-muted px-2 py-1 text-xs text-text-secondary">
                        {item}
                      </code>
                    ))}
                  </div>
                </div>

                {option.details && <p className="text-xs text-text-secondary">{option.details}</p>}
              </div>

              <div className="mt-5 flex justify-end">
                {option.provider ? (
                  <button
                    type="button"
                    disabled={!canManageStorage || Boolean(isBusy)}
                    onClick={() => connectProvider(option.provider!, statuses[option.provider!])}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCwIcon className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                    {isBusy ? 'Checking...' : option.statusLabel === 'Connected' ? 'Refresh' : 'Connect'}
                  </button>
                ) : (
                  option.action
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default SettingsStorageOptionsPanel;
