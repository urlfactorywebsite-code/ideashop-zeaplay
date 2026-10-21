import type { AvatarAsset, User } from '../types';
import { clearAvatarResources } from './avatarResources';

const profiles = new Map<string, User>();
let generation = 0;
export const profileGeneration = () => generation;
const listeners = new Set<() => void>();
export const subscribeProfiles = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const latestProfile = (id?: string) => id ? profiles.get(id) : undefined;
export function publishProfile(user: User): User {
  const previous = profiles.get(user.id);
  if (previous?.updatedAt && user.updatedAt && Date.parse(previous.updatedAt) > Date.parse(user.updatedAt)) return previous;
  if (previous?.avatarAsset?.id === user.avatarAsset?.id && previous?.avatarAsset?.updatedAt && user.avatarAsset?.updatedAt
      && Date.parse(previous.avatarAsset.updatedAt) > Date.parse(user.avatarAsset.updatedAt)) {
    user = { ...user, avatarAsset: previous.avatarAsset, avatarUrl: previous.avatarUrl, profileImageUrl: previous.profileImageUrl };
  }
  profiles.set(user.id, user);
  listeners.forEach(listener => listener());
  return user;
}
export function publishAvatarAsset(asset: AvatarAsset) {
  for (const profile of profiles.values()) {
    if (profile.avatarAssetId === asset.id) publishProfile({ ...profile, avatarAsset: asset, avatarUrl: asset.url ?? null, profileImageUrl: asset.url ?? null });
  }
}
export function clearProfileCache() { generation++; profiles.clear(); clearAvatarResources(); listeners.forEach(listener => listener()); }
