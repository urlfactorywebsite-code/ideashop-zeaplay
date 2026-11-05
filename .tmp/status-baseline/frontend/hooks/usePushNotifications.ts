import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/mockApi';
import { useAuth } from './useAuth';
import { getAccessToken } from '../services/tokenStorage';
import {
  bounded, endpointHash, getPushRegistration, isCurrentPushAccount, isPushStorageEvent,
  notifyPushChanged, publicKeyBytes, PUSH_STATE_EVENT, subscriptionMatchesKey,
  supportsBrowserPush, syncPushAccount,
} from '../services/pushBrowser';
import type { PushDevice, PushServerStatus } from '../types/push';

type PushState = {
  permission: NotificationPermission | 'unsupported';
  devices: PushDevice[];
  server: PushServerStatus | null;
  currentDeviceId: string | null;
  browserSubscribed: boolean;
  refreshing: boolean;
  isLoading: boolean;
  error: string | null;
};
const initial: PushState = {
  permission: 'unsupported', devices: [], server: null, currentDeviceId: null,
  browserSubscribed: false, refreshing: true, isLoading: false, error: null,
};
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to update push notifications.';

export const usePushNotifications = () => {
  const { user, isCurrentSession } = useAuth();
  const [state, setState] = useState<PushState>(initial);
  const busy = useRef(false);
  const sequence = useRef(0);
  const supported = supportsBrowserPush();
  const account = user?.tenantId ? { userId: user.id, tenantId: user.tenantId } : null;
  const accountKey = account ? `${account.tenantId}:${account.userId}` : '';
  const token = getAccessToken();
  const identity = useRef(accountKey);
  identity.current = accountKey;

  const refreshSubscription = useCallback(async () => {
    if (!accountKey) return;
    if (!isCurrentSession()) {
      setState(previous => ({ ...previous, refreshing: false, devices: [], currentDeviceId: null,
        error: 'Your account changed. Refresh this page and try again.' }));
      return;
    }
    const request = ++sequence.current;
    setState(previous => ({ ...previous, refreshing: true }));
    try {
      const [devices, server] = await Promise.all([api.getPushDevices(), api.getPushStatus()]);
      let subscription: PushSubscription | null = null;
      let workerError: string | null = null;
      if (supported) {
        try {
          await syncPushAccount({ userId: user!.id, tenantId: user!.tenantId! }, token);
          const registration = await getPushRegistration();
          subscription = registration ? await registration.pushManager.getSubscription() : null;
        } catch (error) { workerError = message(error); }
      }
      const hash = subscription ? await endpointHash(subscription.endpoint) : null;
      if (sequence.current !== request || identity.current !== accountKey || getAccessToken() !== token || !isCurrentSession()) return;
      setState(previous => ({
        ...previous, devices, server, error: workerError, refreshing: false,
        permission: supported ? Notification.permission : 'unsupported',
        browserSubscribed: Boolean(subscription),
        currentDeviceId: devices.find(device => device.endpointHash === hash)?.id ?? null,
      }));
    } catch (error) {
      if (sequence.current === request && identity.current === accountKey && getAccessToken() === token) {
        setState(previous => ({ ...previous, refreshing: false, currentDeviceId: null,
          permission: supported ? Notification.permission : 'unsupported', error: message(error) }));
      }
    }
  }, [accountKey, supported, token, isCurrentSession]);

  useEffect(() => {
    setState(initial);
    void refreshSubscription();
    const refresh = () => { if (!document.hidden && !busy.current) void refreshSubscription(); };
    const storage = (event: StorageEvent) => { if (isPushStorageEvent(event)) refresh(); };
    const workerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ZEA_PUSH_SUBSCRIPTION_CHANGED') refresh();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener(PUSH_STATE_EVENT, refresh);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', refresh);
    navigator.serviceWorker?.addEventListener('message', workerMessage);
    const poll = window.setInterval(refresh, 60000);
    return () => {
      sequence.current += 1;
      window.clearInterval(poll);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(PUSH_STATE_EVENT, refresh);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', refresh);
      navigator.serviceWorker?.removeEventListener('message', workerMessage);
    };
  }, [refreshSubscription]);

  const requireAccount = () => {
    if (!account || !isCurrentSession() || identity.current !== accountKey || token !== getAccessToken()) {
      throw new Error('Your account changed. Refresh this page and try again.');
    }
    return account;
  };

  const run = async (operation: () => Promise<void>) => {
    if (busy.current) return false;
    busy.current = true;
    ++sequence.current;
    setState(previous => ({ ...previous, isLoading: true, error: null }));
    try {
      requireAccount();
      await operation();
      if (identity.current !== accountKey || token !== getAccessToken()) return false;
      await refreshSubscription();
      notifyPushChanged();
      return true;
    } catch (error) {
      if (identity.current === accountKey && token === getAccessToken()) {
        setState(previous => ({ ...previous, error: message(error) }));
      }
      return false;
    } finally {
      busy.current = false;
      if (identity.current === accountKey) setState(previous => ({ ...previous, isLoading: false }));
    }
  };

  const subscribe = () => run(async () => {
    if (!supported) throw new Error('Push requires HTTPS and a browser with notification support.');
    // Permission is requested from the click, before any network or worker waits.
    const permission = Notification.permission === 'granted'
      ? 'granted' : await Notification.requestPermission();
    setState(previous => ({ ...previous, permission }));
    if (permission !== 'granted') {
      throw new Error(permission === 'denied'
        ? 'Notifications are blocked. Allow them in this site’s browser settings, then refresh status.'
        : 'Permission was not granted. Choose Enable this browser when you are ready.');
    }
    const currentAccount = requireAccount();
    const [{ publicKey }, devices] = await Promise.all([api.getVapidPublicKey(), api.getPushDevices()]);
    await syncPushAccount(currentAccount, token);
    const registration = await getPushRegistration();
    if (!registration) throw new Error('The notification worker is unavailable. Refresh and try again.');
    const key = publicKeyBytes(publicKey);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const hash = await endpointHash(subscription.endpoint);
      const ownDevice = devices.find(device => device.endpointHash === hash);
      if (!ownDevice || !subscriptionMatchesKey(subscription, key)) {
        if (ownDevice) await api.unsubscribePush(subscription.endpoint);
        if (!await subscription.unsubscribe()) throw new Error('Unable to reset this browser subscription. Refresh and try again.');
        subscription = null;
      }
    }
    if (!subscription) {
      subscription = await bounded(registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: key,
      }), 'The browser notification service did not respond. Check your connection and try again.', 20000);
    }
    if (token !== getAccessToken() || !isCurrentPushAccount(currentAccount)) {
      await subscription.unsubscribe();
      throw new Error('Your account changed. Enable notifications again in the current account.');
    }
    const json = subscription.toJSON();
    if (!json.keys?.p256dh || !json.keys?.auth) throw new Error('Browser subscription keys are missing. Refresh and try again.');
    await api.subscribePush({
      endpoint: subscription.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent, deviceLabel: navigator.platform || 'Browser',
    });
  });

  const unsubscribe = () => run(async () => {
    const registration = supported ? await getPushRegistration() : null;
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (subscription) await api.unsubscribePush(subscription.endpoint);
    else if (state.currentDeviceId) await api.removePushDevice(state.currentDeviceId);
    if (subscription && !await subscription.unsubscribe()) {
      throw new Error('Server delivery is disabled, but browser cleanup failed. Refresh and retry.');
    }
  });

  const removeDevice = (id: string) => id === state.currentDeviceId
    ? unsubscribe() : run(() => api.removePushDevice(id));
  const removeAllDevices = () => run(async () => {
    await api.removeAllPushDevices();
    const registration = supported ? await getPushRegistration() : null;
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (subscription && !await subscription.unsubscribe()) {
      throw new Error('All registered devices are disabled. Refresh to finish this browser’s cleanup.');
    }
  });

  return {
    ...state, supported, isSubscribed: Boolean(state.currentDeviceId) && state.permission === 'granted',
    subscribe, unsubscribe, refreshSubscription, removeDevice, removeAllDevices,
  };
};
