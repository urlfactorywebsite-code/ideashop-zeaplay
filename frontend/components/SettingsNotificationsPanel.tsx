import React, { useEffect, useMemo, useState } from 'react';

import { BellIcon, CheckCircleIcon, ExclamationTriangleIcon } from './icons';
import api from '../services/mockApi';
import { NotificationModule, NotificationPreference, Role } from '../types';
import { useAuth } from '../hooks/useAuth';
import { usePushNotifications } from '../hooks/usePushNotifications';

type StatusMessage = {
  type: 'success' | 'error';
  message: string;
} | null;

const MODULES: Array<{
  module: NotificationModule;
  label: string;
  description: string;
  accent: string;
}> = [
  {
    module: 'tasks',
    label: 'Tasks',
    description: 'Assignments, updates, overdue alerts, and mission log activity.',
    accent: 'from-emerald-500/30 via-emerald-500/10 to-transparent',
  },
  {
    module: 'tickets',
    label: 'Tickets',
    description: 'Support ticket lifecycle changes and approvals.',
    accent: 'from-sky-500/30 via-sky-500/10 to-transparent',
  },
  {
    module: 'chat',
    label: 'Chat',
    description: 'Direct messages and group chat updates.',
    accent: 'from-fuchsia-500/30 via-fuchsia-500/10 to-transparent',
  },
  {
    module: 'comments',
    label: 'Comments',
    description: 'Mission log comments and mentions.',
    accent: 'from-amber-500/30 via-amber-500/10 to-transparent',
  },
  {
    module: 'users',
    label: 'Users',
    description: 'User onboarding, role updates, and access changes.',
    accent: 'from-violet-500/30 via-violet-500/10 to-transparent',
  },
  {
    module: 'departments',
    label: 'Departments',
    description: 'Department updates and structure changes.',
    accent: 'from-rose-500/30 via-rose-500/10 to-transparent',
  },
];

const normalizePreferences = (preferences: NotificationPreference[]) => {
  const prefMap = new Map(preferences.map((pref) => [pref.module, pref]));
  return MODULES.map((item) => prefMap.get(item.module) ?? { module: item.module, pushEnabled: true });
};

const StatusBanner: React.FC<{ status: StatusMessage }> = ({ status }) => {
  if (!status) return null;
  const Icon = status.type === 'success' ? CheckCircleIcon : ExclamationTriangleIcon;
  const classes =
    status.type === 'success'
      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
      : 'bg-amber-500/10 text-amber-200 border-amber-500/40';

  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${classes}`}>
      <Icon className="h-5 w-5 mt-0.5" />
      <span>{status.message}</span>
    </div>
  );
};

const SettingsNotificationsPanel: React.FC = () => {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingModule, setSavingModule] = useState<NotificationModule | null>(null);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [testLoading, setTestLoading] = useState(false);
  const {
    supported,
    permission,
    isSubscribed,
    isLoading: subscriptionLoading,
    error,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      setStatus(null);
      try {
        const data = await api.getNotificationPreferences();
        if (isMounted) {
          setPreferences(data);
        }
      } catch (loadError) {
        if (isMounted) {
          setStatus({
            type: 'error',
            message: 'Unable to load notification preferences. Please refresh.',
          });
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      isMounted = false;
    };
  }, []);

  const normalizedPreferences = useMemo(() => normalizePreferences(preferences), [preferences]);

  const permissionLabel = useMemo(() => {
    if (!supported) return 'Unsupported';
    if (permission === 'granted') return 'Enabled';
    if (permission === 'denied') return 'Blocked';
    return 'Needs permission';
  }, [permission, supported]);

  const handleToggle = async (module: NotificationModule) => {
    setStatus(null);
    setSavingModule(module);
    const next = normalizedPreferences.map((pref) =>
      pref.module === module ? { ...pref, pushEnabled: !pref.pushEnabled } : pref
    );
    setPreferences(next);
    try {
      const updated = await api.updateNotificationPreferences(next);
      setPreferences(updated);
      setStatus({
        type: 'success',
        message: 'Notification preferences updated.',
      });
    } catch (updateError) {
      setStatus({
        type: 'error',
        message: 'Unable to update preferences. Please try again.',
      });
      setPreferences(normalizedPreferences);
    } finally {
      setSavingModule(null);
    }
  };

  const handleTest = async () => {
    setTestLoading(true);
    setStatus(null);
    try {
      const result = await api.sendPushTest();
      if (result.delivered < 1) {
        setStatus({
          type: 'error',
          message: 'No active push subscription received the test. Enable this device again and retry.',
        });
        return;
      }
      setStatus({
        type: 'success',
        message: `Test notification delivered to ${result.delivered} device${result.delivered === 1 ? '' : 's'}.`,
      });
    } catch (testError) {
      setStatus({
        type: 'error',
        message: 'Test notification failed. Verify permission and try again.',
      });
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="bg-surface border border-border-color rounded-xl p-6 space-y-6 shadow-sm">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <BellIcon className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Notifications</h2>
            <p className="text-sm text-text-secondary">
              Control push alerts by module while keeping history intact.
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
            permission === 'granted'
              ? 'bg-emerald-500/10 text-emerald-300'
              : permission === 'denied'
              ? 'bg-rose-500/10 text-rose-300'
              : 'bg-amber-500/10 text-amber-300'
          }`}
        >
          {permissionLabel}
        </span>
      </div>

      {status && <StatusBanner status={status} />}
      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-3">
          {normalizedPreferences.map((pref) => {
            const moduleMeta = MODULES.find((item) => item.module === pref.module);
            const enabled = pref.pushEnabled;
            return (
              <div
                key={pref.module}
                className={`group relative overflow-hidden rounded-xl border border-border-color/70 bg-gradient-to-r ${
                  moduleMeta?.accent ?? 'from-white/5 via-white/5 to-transparent'
                } px-4 py-4 transition-all duration-300 hover:scale-[1.01]`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">{moduleMeta?.label ?? pref.module}</h3>
                    <p className="text-xs text-text-secondary">{moduleMeta?.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                        enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/10 text-slate-300'
                      }`}
                    >
                      {enabled ? 'Enabled' : 'Muted'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggle(pref.module)}
                      disabled={savingModule === pref.module || loading}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ${
                        enabled
                          ? 'bg-emerald-500/70 shadow-[0_0_12px_rgba(16,185,129,0.55)]'
                          : 'bg-slate-700/60'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-300 ${
                          enabled ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
                {savingModule === pref.module && (
                  <div className="mt-2 text-xs text-text-secondary">Saving...</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-border-color/70 bg-background/60 p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Push delivery</h3>
            <p className="text-xs text-text-secondary">
              Enable browser + mobile notifications for real-time alerts.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span>Device status</span>
              <span className={isSubscribed ? 'text-emerald-300' : 'text-amber-300'}>
                {isSubscribed ? 'Subscribed' : 'Not active'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void subscribe()}
                disabled={!supported || subscriptionLoading || permission === 'denied' || isSubscribed}
                className="inline-flex items-center justify-center rounded-lg bg-primary/90 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {subscriptionLoading ? 'Working...' : 'Enable browser & mobile notifications'}
              </button>
              <button
                type="button"
                onClick={() => void unsubscribe()}
                disabled={!supported || subscriptionLoading || !isSubscribed}
                className="inline-flex items-center justify-center rounded-lg border border-border-color/70 px-3 py-2 text-xs font-semibold text-text-primary transition hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Disable on this device
              </button>
            </div>
            {permission === 'denied' && (
              <p className="text-xs text-rose-300">
                Permission is blocked in the browser settings. Allow notifications to enable push.
              </p>
            )}
          </div>

          {user?.role && (user.role === Role.ADMIN || user.role === Role.OWNER) && (
            <button
              type="button"
              onClick={handleTest}
              disabled={testLoading || !supported || permission !== 'granted' || !isSubscribed}
              className="inline-flex items-center justify-center rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition hover:border-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testLoading ? 'Sending test...' : 'Test notification'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsNotificationsPanel;
