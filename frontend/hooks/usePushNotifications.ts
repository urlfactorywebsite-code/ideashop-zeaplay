import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/mockApi';

type PushPermission = NotificationPermission | 'unsupported';

type PushState = {
  supported: boolean;
  permission: PushPermission;
  isSubscribed: boolean;
  isLoading: boolean;
  error: string | null;
};

const DEFAULT_STATE: PushState = {
  supported: false,
  permission: 'unsupported',
  isSubscribed: false,
  isLoading: false,
  error: null,
};

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const registerServiceWorker = async (): Promise<ServiceWorkerRegistration> => {
  const registration = await navigator.serviceWorker.register('/sw.js', {
    updateViaCache: 'none',
  });
  await registration.update().catch(() => undefined);
  return navigator.serviceWorker.ready;
};

const resetServiceWorkerRegistrations = async () => {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
};

const isPushServiceError = (error: unknown) =>
  error instanceof Error && error.message.toLowerCase().includes('push service error');

const formatPushError = (error: unknown): string => {
  if (isPushServiceError(error)) {
    return 'Browser push service rejected registration. Allow notifications for this site, keep the browser notification service enabled, then try again.';
  }
  return error instanceof Error ? error.message : 'Unable to enable push notifications.';
};

export const usePushNotifications = () => {
  const [state, setState] = useState<PushState>(DEFAULT_STATE);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const supported = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }, []);

  const refreshSubscription = useCallback(async () => {
    if (!supported) {
      setState((prev) => ({ ...prev, supported: false, permission: 'unsupported', isSubscribed: false }));
      return;
    }

    try {
      const registration = registrationRef.current ?? (await registerServiceWorker());
      registrationRef.current = registration;
      const subscription = await registration.pushManager.getSubscription();
      setState((prev) => ({
        ...prev,
        supported: true,
        permission: Notification.permission,
        isSubscribed: Boolean(subscription),
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        supported: true,
        permission: Notification.permission,
        isSubscribed: false,
        error: error instanceof Error ? error.message : 'Unable to check push subscription.',
      }));
    }
  }, [supported]);

  useEffect(() => {
    void refreshSubscription();
  }, [refreshSubscription]);

  const subscribe = useCallback(async () => {
    if (!supported) {
      setState((prev) => ({ ...prev, supported: false, permission: 'unsupported', error: 'Push not supported.' }));
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      let permission = Notification.permission;
      if (permission !== 'granted') {
        permission = await Notification.requestPermission();
      }

      if (permission !== 'granted') {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          permission,
          isSubscribed: false,
          error: permission === 'denied' ? 'Permission blocked in the browser.' : null,
        }));
        return;
      }

      let registration = registrationRef.current ?? (await registerServiceWorker());
      registrationRef.current = registration;
      const existing = await registration.pushManager.getSubscription();
      let subscription = existing;

      if (!subscription) {
        const { publicKey } = await api.getVapidPublicKey();
        const applicationServerKey = urlBase64ToUint8Array(publicKey);
        try {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
        } catch (subscribeError) {
          if (!isPushServiceError(subscribeError)) {
            throw subscribeError;
          }

          await resetServiceWorkerRegistrations();
          registration = await registerServiceWorker();
          registrationRef.current = registration;
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
        }
      }

      const json = subscription.toJSON();
      await api.subscribePush({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: json.keys?.p256dh ?? '',
          auth: json.keys?.auth ?? '',
        },
        userAgent: navigator.userAgent,
        deviceLabel: navigator.platform,
      });

      setState((prev) => ({
        ...prev,
        isLoading: false,
        permission,
        isSubscribed: true,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        permission: Notification.permission,
        error: formatPushError(error),
      }));
    }
  }, [supported]);

  const unsubscribe = useCallback(async () => {
    if (!supported) {
      setState((prev) => ({ ...prev, supported: false, permission: 'unsupported', isSubscribed: false }));
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const registration = registrationRef.current ?? (await registerServiceWorker());
      registrationRef.current = registration;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.unsubscribePush(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isSubscribed: false,
        permission: Notification.permission,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unable to disable push notifications.',
      }));
    }
  }, [supported]);

  return {
    ...state,
    subscribe,
    unsubscribe,
    refreshSubscription,
  };
};
