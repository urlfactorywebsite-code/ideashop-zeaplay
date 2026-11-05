type AvatarAssetLike = {
  url?: string | null;
  dataUrl?: string | null;
  externalUrl?: string | null;
} | null | undefined;

export type AvatarSource = {
  profileImageUrl?: string | null;
  avatarUrl?: string | null;
  avatarAsset?: AvatarAssetLike;
} | null | undefined;

export const getUserAvatarUrl = (source: AvatarSource): string | null => {
  if (!source) {
    return null;
  }
  // Explicit null means removal. A stale legacy URL must not resurrect the photo.
  if (source.avatarUrl !== undefined) return source.avatarUrl;

  return (
    source.profileImageUrl ??
    source.avatarAsset?.url ??
    source.avatarAsset?.dataUrl ??
    source.avatarAsset?.externalUrl ??
    null
  );
};
