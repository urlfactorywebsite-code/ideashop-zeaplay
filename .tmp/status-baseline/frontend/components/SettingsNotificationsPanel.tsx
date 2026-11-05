import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { BellIcon } from './icons';
import api from '../services/mockApi';
import { NotificationModule, NotificationPreference, Role } from '../types';
import type { PushDevice } from '../types/push';
import { useAuth } from '../hooks/useAuth';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { isPushStorageEvent, notifyPushChanged, PUSH_STATE_EVENT } from '../services/pushBrowser';

type StatusMessage = { type: 'success' | 'error'; message: string } | null;
const MODULES: Array<{ module: NotificationModule; label: string; description: string }> = [
  { module: 'tasks', label: 'Tasks', description: 'Assignments, updates, deadlines and subtask activity.' },
  { module: 'projects', label: 'Projects', description: 'New projects and project updates you can access.' },
  { module: 'clients', label: 'Clients', description: 'New clients and client updates permitted for your role.' },
  { module: 'rewards', label: 'Rewards and achievements', description: 'Achievement unlocks and reward activity.' },
  { module: 'tickets', label: 'Tickets', description: 'Ticket lifecycle changes and approvals.' },
  { module: 'chat', label: 'Chat', description: 'Direct messages, group conversations and mentions.' },
  { module: 'comments', label: 'Comments', description: 'Mission log comments and task mentions.' },
  { module: 'users', label: 'Users', description: 'Onboarding, role updates and access changes.' },
  { module: 'departments', label: 'Departments', description: 'Department updates and team structure.' },
];
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-border-color px-4 py-2 text-sm font-medium text-text-primary hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';
const panel = 'rounded-xl border border-border-color bg-surface p-4 sm:p-6';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
const dateLabel = (date: string | null) => date && !Number.isNaN(Date.parse(date)) ? new Date(date).toLocaleString() : 'No activity recorded';
const deviceName = (device: PushDevice) => {
  const platform = ({ Win32: 'Windows', MacIntel: 'Mac', Linux: 'Linux' } as Record<string, string>)[device.deviceLabel || ''] || device.deviceLabel || 'Browser';
  const agent = device.userAgent || '';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : '';
  return browser ? `${platform} · ${browser}` : platform;
};

const SettingsNotificationsPanel: React.FC = () => {
  const { user, isCurrentSession } = useAuth();
  const push = usePushNotifications();
  const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PushDevice | 'all' | null>(null);
  const saveLock = useRef(false);
  const loadSequence = useRef(0);
  const testLock = useRef(false);
  const mounted = useRef(true);
  const preferenceMap = useMemo(() => new Map(preferences?.map(pref => [pref.module, pref.pushEnabled]) ?? []), [preferences]);

  const loadPreferences = useCallback(async () => {
    if (saveLock.current) return;
    if (!isCurrentSession()) {
      setPreferences(null);
      setPreferenceError('Your account changed. Refresh this page and try again.');
      return;
    }
    const request = ++loadSequence.current;
    try {
      const data = await api.getNotificationPreferences();
      if (mounted.current && request === loadSequence.current && isCurrentSession()) { setPreferences(data); setPreferenceError(null); }
    } catch (error) {
      if (mounted.current && request === loadSequence.current) setPreferenceError(`Unable to load preferences. ${errorMessage(error)}`);
    }
  }, [user?.id, user?.tenantId, isCurrentSession]);

  useEffect(() => {
    mounted.current = true;
    setPreferences(null);
    void loadPreferences();
    const refresh = () => { if (!document.hidden) void loadPreferences(); };
    const storage = (event: StorageEvent) => { if (isPushStorageEvent(event)) refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener(PUSH_STATE_EVENT, refresh);
    window.addEventListener('storage', storage);
    return () => {
      mounted.current = false;
      ++loadSequence.current;
      window.removeEventListener('focus', refresh);
      window.removeEventListener(PUSH_STATE_EVENT, refresh);
      window.removeEventListener('storage', storage);
    };
  }, [loadPreferences]);

  const savePreferences = async (changes: NotificationPreference[]) => {
    if (saveLock.current || !preferences) return;
    if (!isCurrentSession()) {
      setStatus({ type: 'error', message: 'Your account changed. Refresh this page and try again.' });
      return;
    }
    saveLock.current = true;
    ++loadSequence.current;
    setSaving(true); setStatus(null);
    try {
      const updated = await api.updateNotificationPreferences(changes);
      if (!mounted.current || !isCurrentSession()) return;
      setPreferences(updated);
      setStatus({ type: 'success', message: 'Push preferences saved across your devices.' });
      notifyPushChanged();
    } catch (error) {
      if (mounted.current) setStatus({ type: 'error', message: `Preferences were not saved. ${errorMessage(error)}` });
    } finally {
      saveLock.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const sendTest = async (device: PushDevice) => {
    if (testLock.current) return;
    if (!isCurrentSession()) {
      setStatus({ type: 'error', message: 'Your account changed. Refresh this page and try again.' });
      return;
    }
    testLock.current = true;
    setTesting(device.id); setStatus(null);
    try {
      const result = await api.sendPushTest(device.id);
      if (!mounted.current) return;
      setStatus({ type: result.accepted ? 'success' : 'error', message: result.accepted
        ? `Test accepted by the push service for ${deviceName(device)}. Check that device for the notification. Browser and operating system settings can still hide it.`
        : `The push service did not accept the test. ${result.revoked ? 'An expired device was removed; enable it again.' : 'Check the device and server configuration, then retry.'}` });
      await push.refreshSubscription();
    } catch (error) {
      if (mounted.current) setStatus({ type: 'error', message: `Test could not be confirmed. ${errorMessage(error)}` });
    } finally {
      testLock.current = false;
      if (mounted.current) setTesting(null);
    }
  };

  const confirmRemoval = async () => {
    if (!confirmation) return;
    const all = confirmation === 'all';
    setStatus(null);
    const ok = all ? await push.removeAllDevices() : await push.removeDevice(confirmation.id);
    if (ok && mounted.current) {
      setConfirmation(null);
      setStatus({ type: 'success', message: all ? 'Push disabled on all your registered devices.' : 'Push disabled on the selected device.' });
    }
  };
  const permissionLabel = !push.supported ? 'Unavailable' : push.permission === 'granted'
    ? 'Allowed' : push.permission === 'denied' ? 'Blocked' : 'Not requested';
  const working = push.isLoading || Boolean(testing);
  const currentDevice = push.devices.find(device => device.id === push.currentDeviceId);

  return <div className="space-y-6" aria-busy={push.isLoading || saving}>
    <div className={`${panel} space-y-4`}>
      <div className="flex items-start gap-3">
        <BellIcon className="h-6 w-6 shrink-0 text-primary" />
        <div><h2 className="text-xl font-semibold text-text-primary">Push notifications</h2>
          <p className="mt-1 text-sm text-text-secondary">Manage alerts for your account on every registered browser and device.</p></div>
      </div>
      {status && <p role={status.type === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${status.type === 'error' ? 'border-rose-500/50 text-rose-500' : 'border-emerald-500/50 text-emerald-500'}`}>{status.message}</p>}
      {push.error && <p role="alert" className="rounded-lg border border-rose-500/50 p-3 text-sm text-rose-500">{push.error}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <div><p className="text-xs text-text-secondary">Browser permission</p><p className="mt-1 font-semibold text-text-primary">{permissionLabel}</p></div>
        <div><p className="text-xs text-text-secondary">This browser</p><p className="mt-1 font-semibold text-text-primary">{push.refreshing ? 'Checking…' : push.isSubscribed ? 'Enabled for your account' : 'Not enabled for your account'}</p></div>
        <div><p className="text-xs text-text-secondary">Server delivery</p><p className="mt-1 font-semibold text-text-primary">{!push.server ? 'Status unavailable' : push.server.configured ? 'Configured' : 'Setup required'}</p></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${button} bg-primary text-white`} disabled={!push.supported || !push.server?.configured || push.permission === 'denied' || working || push.refreshing} onClick={async () => {
          setStatus(null);
          if (await push.subscribe()) setStatus({ type: 'success', message: 'This browser is registered for your account. Send a test to check delivery.' });
        }}>{push.isLoading ? 'Working…' : push.isSubscribed ? 'Reconnect this browser' : 'Enable this browser'}</button>
        <button type="button" className={button} disabled={working || (!push.browserSubscribed && !push.currentDeviceId)} onClick={async () => {
          setStatus(null);
          if (await push.unsubscribe()) setStatus({ type: 'success', message: 'Push disabled on this browser.' });
        }}>Disable this browser</button>
        <button type="button" className={button} disabled={working || !push.server?.configured || !currentDevice} onClick={() => currentDevice && void sendTest(currentDevice)}>Send test to this browser</button>
        <button type="button" className={button} disabled={working || push.refreshing} onClick={() => { void push.refreshSubscription(); void loadPreferences(); }}>Refresh status</button>
      </div>
      {!push.supported && <p className="text-sm text-text-secondary">Push needs a secure connection (HTTPS or localhost) and a browser with push support. You can still manage your other devices and alert categories here.</p>}
      {push.permission === 'denied' && <p className="text-sm text-text-secondary">Open this site’s permissions in your browser settings, allow notifications, then select Refresh status. The app cannot override a blocked permission.</p>}
      {push.server && !push.server.configured && <p className="text-sm text-text-secondary">Server push delivery needs administrator setup. Your notification history remains available.</p>}
      <p className="text-xs text-text-secondary">Signing out disables push on this browser. Other signed-in devices keep their own settings.</p>
    </div>

    <section className={`${panel} space-y-4`} aria-labelledby="push-categories-title">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="push-categories-title" className="text-lg font-semibold text-text-primary">Alert categories</h3>
        <p className="text-sm text-text-secondary">Choose which alerts reach your devices. Muting push keeps in-app notification history.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={saving || !preferences || Boolean(preferenceError)} onClick={() => void savePreferences(MODULES.map(({ module }) => ({ module, pushEnabled: true })))}>Enable all categories</button>
          <button type="button" className={button} disabled={saving || !preferences || Boolean(preferenceError)} onClick={() => void savePreferences(MODULES.map(({ module }) => ({ module, pushEnabled: false })))}>Mute all categories</button>
        </div>
      </div>
      {preferenceError && <p role="alert" className="text-sm text-rose-500">{preferenceError} <button type="button" className="underline" onClick={() => void loadPreferences()}>Retry preferences</button></p>}
      {!preferences && !preferenceError && <p role="status" className="text-sm text-text-secondary">Loading alert preferences…</p>}
      {preferences && <div className="grid gap-3 md:grid-cols-2">{MODULES.map(({ module, label, description }) => {
        const enabled = preferenceMap.get(module) ?? true;
        return <div key={module} className="flex items-center justify-between gap-4 rounded-lg border border-border-color bg-background p-4">
          <div className="min-w-0"><h4 className="font-medium text-text-primary">{label}</h4><p className="mt-1 text-xs text-text-secondary">{description}</p></div>
          <button type="button" role="switch" aria-checked={enabled} aria-label={`${label} push alerts`} disabled={saving || Boolean(preferenceError)}
            onClick={() => void savePreferences([{ module, pushEnabled: !enabled }])}
            className={`${button} shrink-0 ${enabled ? 'border-primary bg-primary/10' : ''}`}>{enabled ? 'On' : 'Off'}</button>
        </div>;
      })}</div>}
      {saving && <p role="status" className="text-sm text-text-secondary">Saving preferences…</p>}
    </section>

    <section className={`${panel} space-y-4`} aria-labelledby="push-devices-title">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="push-devices-title" className="text-lg font-semibold text-text-primary">Your registered devices ({push.devices.length})</h3>
        <p className="text-sm text-text-secondary">Test or disable any device registered to your account.</p></div>
        <button type="button" className={button} disabled={working || !push.devices.length} onClick={() => setConfirmation('all')}>Disable all devices</button></div>
      {!push.devices.length && <p className="rounded-lg border border-dashed border-border-color p-5 text-sm text-text-secondary">{push.refreshing ? 'Checking registered devices…' : 'No registered devices. Enable this browser to start receiving push alerts.'}</p>}
      <ul className="space-y-3">{push.devices.map(device => <li key={device.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border-color bg-background p-4">
        <div className="min-w-0 break-words"><p className="font-medium text-text-primary">{deviceName(device)}{device.id === push.currentDeviceId && <span className="ml-2 text-xs text-primary">This browser</span>}</p>
          <p className="mt-1 text-xs text-text-secondary">Registered {dateLabel(device.createdAt)}</p><p className="text-xs text-text-secondary">Last activity {dateLabel(device.lastSeenAt)}</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={working || !push.server?.configured} aria-label={`Send test to ${deviceName(device)}`} onClick={() => void sendTest(device)}>{testing === device.id ? 'Sending…' : 'Send test'}</button>
          <button type="button" className={button} disabled={working} aria-label={`Disable ${deviceName(device)}`} onClick={() => setConfirmation(device)}>Disable</button></div>
      </li>)}</ul>
      <p className="text-xs text-text-secondary">Last activity means registration or acceptance by the push service. It does not confirm the notification appeared on screen.</p>
    </section>

    {(user?.role === Role.OWNER || user?.role === Role.ADMIN) && push.server && <details className={panel}>
      <summary className="cursor-pointer font-medium text-text-primary">Server configuration status</summary>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{[
        ['Public key', push.server.publicKeyConfigured], ['Private key', push.server.privateKeyConfigured],
        ['Contact subject', push.server.subjectConfigured], ['Matching valid configuration', push.server.configurationValid],
      ].map(([label, ok]) => <div key={String(label)}><dt className="text-text-secondary">{label}</dt><dd className="font-medium text-text-primary">{ok ? 'Ready' : 'Needs attention'}</dd></div>)}</dl>
      <p className="mt-4 text-xs text-text-secondary">Signing keys are managed in the server environment. After a key change, re-enable each browser and send a test.</p>
    </details>}

    <Dialog open={Boolean(confirmation)} onClose={() => { if (!push.isLoading) setConfirmation(null); }} className="relative z-[100]">
      <DialogBackdrop className="fixed inset-0 bg-black/60" />
      <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4"><DialogPanel className="w-full max-w-md rounded-xl border border-border-color bg-surface p-5 shadow-xl">
        <DialogTitle className="text-lg font-semibold text-text-primary">{confirmation === 'all' ? 'Disable push on all devices?' : 'Disable push on this device?'}</DialogTitle>
        <Description className="mt-3 break-words text-sm text-text-secondary">{confirmation === 'all' ? 'All browsers and devices registered to your account will stop receiving push alerts.' : `Push alerts will stop on ${confirmation ? deviceName(confirmation) : 'this device'}.`} You can enable notifications again from that browser. Alert preferences and history are preserved.</Description>
        {push.error && <p role="alert" className="mt-3 text-sm text-rose-500">{push.error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button data-autofocus type="button" className={button} disabled={push.isLoading} onClick={() => setConfirmation(null)}>Cancel</button><button type="button" className={`${button} bg-primary text-white`} disabled={push.isLoading} onClick={() => void confirmRemoval()}>{push.isLoading ? 'Disabling…' : 'Confirm disable'}</button></div>
      </DialogPanel></div>
    </Dialog>
  </div>;
};
export default SettingsNotificationsPanel;
