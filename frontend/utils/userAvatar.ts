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

  return (
    source.profileImageUrl ??
    source.avatarUrl ??
    source.avatarAsset?.url ??
    source.avatarAsset?.dataUrl ??
    source.avatarAsset?.externalUrl ??
    null
  );
};
