import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { http } from '../services/mockApi';
import type { NavigationDocument, NavigationPage } from '../types/navigation';
import { applySidebarPreferences, emptySidebarPreferences, parseSidebarPreferences, sidebarStorageKey, type SidebarPreferences } from '../utils/sidebarPreferences';

import { pageIdForPath, migratePersonal } from '../utils/navigationPreferences';
export { pageIdForPath, migratePersonal } from '../utils/navigationPreferences';

export const NAVIGATION_UPDATED = 'zea:navigation-updated';
type Context = {
  configuration: NavigationDocument | null; error: string; loading: boolean;
  revalidate: () => Promise<void>; accept: (value: NavigationDocument) => void;
  page: (id: string) => NavigationPage | undefined;
  visible: (id: string) => boolean; preferences: SidebarPreferences;
  savePersonal: (value: SidebarPreferences) => void;
  decorate: <T extends { to: unknown; label: string }>(links: T[]) => T[];
};
const NavigationContext = createContext<Context | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const identity = `${user?.tenantId}:${user?.id}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  const [stored, setStored] = useState<{ identity: string; value: NavigationDocument } | null>(null);
  const [error, setError] = useState('');
  const [savedPersonal, setSavedPersonal] = useState<{ key: string | null; value: SidebarPreferences }>({ key: null, value: emptySidebarPreferences() });
  const current = stored?.identity === identity ? stored.value : null;
  const request = useRef<Promise<void> | null>(null);
  const storageKey = user ? sidebarStorageKey(user.tenantId, user.id) : null;
  const preferences = savedPersonal.key === storageKey ? savedPersonal.value : emptySidebarPreferences();
  const accept = useCallback((value: NavigationDocument) => { if (identityRef.current === identity) { setStored({ identity, value }); setError(''); } }, [identity]);
  const revalidate = useCallback(async () => {
    if (!user) return;
    if (request.current) return request.current;
    const expected = identity;
    const work = (async () => {
      try {
        const { data } = await http.get<NavigationDocument>('/navigation', { headers: { 'Cache-Control': 'no-cache' } });
        if (identityRef.current === expected) {
          setStored(previous => previous?.identity === expected && previous.value.revision > data.revision ? previous : { identity: expected, value: data });
          setError('');
        }
      } catch {
        if (identityRef.current === expected) setError('Unable to validate workspace navigation. Retry or contact your owner.');
      }
    })();
    request.current = work;
    try { await work; } finally { if (request.current === work) request.current = null; }
  }, [identity, user]);
  useEffect(() => { request.current = null; setStored(null); setError(''); void revalidate(); }, [identity]);
  // Revalidate on navigation, focus and every 15 seconds; no new realtime channel.
  useEffect(() => { void revalidate(); }, [location.pathname, location.search, revalidate]);
  useEffect(() => {
    const run = () => { if (document.visibilityState !== 'hidden') void revalidate(); };
    const interval = window.setInterval(run, 15000);
    window.addEventListener('focus', run); window.addEventListener(NAVIGATION_UPDATED, run);
    return () => { clearInterval(interval); window.removeEventListener('focus', run); window.removeEventListener(NAVIGATION_UPDATED, run); };
  }, [revalidate]);
  useEffect(() => {
    const read = () => {
      let value = emptySidebarPreferences();
      try { value = migratePersonal(parseSidebarPreferences(storageKey ? localStorage.getItem(storageKey) : null)); } catch { /* Storage unavailable. */ }
      setSavedPersonal({ key: storageKey, value });
    };
    read();
    const sync = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) read(); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [storageKey]);
  const savePersonal = (value: SidebarPreferences) => {
    if (!current?.canManagePersonal || !storageKey || identityRef.current !== identity) throw Error('Personal layout management is not permitted.');
    localStorage.setItem(storageKey, JSON.stringify(value)); setSavedPersonal({ key: storageKey, value });
  };
  const page = (id: string) => current?.pages.find(entry => entry.id === id);
  const visible = (id: string) => page(id)?.access === 'allowed' && (id !== 'management'
    || current?.pages.some(entry => entry.parentId === 'management' && entry.access === 'allowed') === true);
  function decorate<T extends { to: unknown; label: string }>(links: T[]): T[] {
    const keyOf = (link: T) => pageIdForPath(String(link.to)) || '';
    const baseline = links.filter(link => visible(keyOf(link)))
      .sort((a, b) => (page(keyOf(a))?.sortOrder ?? 1000) - (page(keyOf(b))?.sortOrder ?? 1000));
    return applySidebarPreferences(baseline, keyOf, preferences);
  }
  return <NavigationContext.Provider value={{ configuration: current, error, loading: !current && !error, revalidate, accept, page, visible, preferences, savePersonal, decorate }}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const value = useContext(NavigationContext);
  if (!value) throw Error('NavigationProvider is required.');
  return value;
}
