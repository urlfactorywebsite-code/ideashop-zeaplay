import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Role, User } from '../types';
import { getFrameClassName } from '../constants/avatarFrames';
import { getUserAvatarUrl } from '../utils/userAvatar';
import { latestProfile, subscribeProfiles } from '../services/profileEvents';
import { avatarImages, ensureAvatarProfile } from '../services/avatarResources';

export type AvatarPerson = Partial<Pick<User, 'id' | 'name' | 'role' | 'avatarFrame' | 'avatarUrl' | 'avatarAsset' | 'profileImageUrl' | 'tenantId'>>;
export const avatarInitials = (name = '') => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase() || '?';
export const avatarColor = (name = '') => `hsl(${Array.from(name).reduce((hash, char) => (hash * 31 + char.codePointAt(0)!) >>> 0, 0) % 360} 38% 30%)`;

export default function Avatar({ user, size = 40, className = '' }: { user?: AvatarPerson | null; size?: number; className?: string }) {
  const fresh = useSyncExternalStore(subscribeProfiles, () => latestProfile(user?.id), () => undefined);
  const person = fresh && (!user?.tenantId || fresh.tenantId === user.tenantId) ? { ...user, ...fresh } : user;
  const source = getUserAvatarUrl(person);
  useEffect(() => {
    if (user?.id && !fresh && !('avatarUrl' in user)) ensureAvatarProfile(user.id).catch(() => {});
  }, [user?.id, !!fresh]);
  const [image, setImage] = useState<{ source: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let release: (() => void) | undefined;
    setFailed(null);
    setImage(null);
    if (!source) return;
    if (/^\/api\/(?:avatars\/[^/]+\/image|users\/[^/]+\/avatar\/image)(?:\?|$)/.test(source)) {
      // Never attach application credentials to an arbitrary image URL.
      const resource = avatarImages.acquire(source, size <= 64 ? 128 : 512);
      release = resource.release;
      resource.promise.then(url => {
        if (!live) return;
        setImage({ source, url });
      }).catch(() => { if (live) setFailed(source); });
    } else if (/^(https?:\/\/|blob:|data:image\/(png|jpeg|webp);base64,|\/(?!\/))/.test(source)) {
      setImage({ source, url: source });
    } else setFailed(source);
    return () => { live = false; release?.(); };
  }, [source, size <= 64, person?.tenantId]);
  const loaded = image?.source === source && failed !== source;
  const name = person?.name || 'User';
  return <span role="img" aria-label={`${name}'s avatar`} aria-busy={!!source && !loaded && failed !== source}
    className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full text-white ${getFrameClassName(person?.avatarFrame ?? 'classic', person?.role ?? Role.USER)} ${className}`}
    style={{ width: size, height: size, backgroundColor: avatarColor(person?.id || name), fontSize: Math.max(10, Math.round(size * .32)) }}>
    <span aria-hidden="true">{avatarInitials(name)}</span>
    {loaded && <img src={image.url} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(source)} />}
  </span>;
}
