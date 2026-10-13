import { useCallback, useEffect, useState } from 'react';
import { AvatarAsset } from '../types';
import api from '../services/mockApi';

interface UseAvatarLibraryResult {
  avatars: AvatarAsset[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setAvatars: React.Dispatch<React.SetStateAction<AvatarAsset[]>>;
}

// Local library avatars
const LIBRARY_AVATARS: AvatarAsset[] = [
  {
    id: 'library-01',
    name: 'Default Avatar 1',
    storageType: 'external_url',
    externalUrl: '/assets/avatars/library/default-avatar-01.svg',
    isDefault: true,
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
  },
  {
    id: 'library-02',
    name: 'Default Avatar 2',
    storageType: 'external_url',
    externalUrl: '/assets/avatars/library/default-avatar-02.svg',
    isDefault: true,
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
  },
  {
    id: 'library-03',
    name: 'Default Avatar 3',
    storageType: 'external_url',
    externalUrl: '/assets/avatars/library/default-avatar-03.svg',
    isDefault: true,
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
  },
  {
    id: 'library-04',
    name: 'Default Avatar 4',
    storageType: 'external_url',
    externalUrl: '/assets/avatars/library/default-avatar-04.svg',
    isDefault: true,
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
  },
  {
    id: 'library-05',
    name: 'Default Avatar 5',
    storageType: 'external_url',
    externalUrl: '/assets/avatars/library/default-avatar-05.svg',
    isDefault: true,
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
  },
  {
    id: 'library-06',
    name: 'Default Avatar 6',
    storageType: 'external_url',
    externalUrl: '/assets/avatars/library/default-avatar-06.svg',
    isDefault: true,
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
  },
  {
    id: 'library-07',
    name: 'Default Avatar 7',
    storageType: 'external_url',
    externalUrl: '/assets/avatars/library/default-avatar-07.svg',
    isDefault: true,
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
  },
  {
    id: 'library-08',
    name: 'Default Avatar 8',
    storageType: 'external_url',
    externalUrl: '/assets/avatars/library/default-avatar-08.svg',
    isDefault: true,
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
  },
  {
    id: 'library-09',
    name: 'Default Avatar 9',
    storageType: 'external_url',
    externalUrl: '/assets/avatars/library/default-avatar-09.svg',
    isDefault: true,
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
  },
  {
    id: 'library-10',
    name: 'Default Avatar 10',
    storageType: 'external_url',
    externalUrl: '/assets/avatars/library/default-avatar-10.svg',
    isDefault: true,
    createdAt: '2023-01-01T00:00:00Z',
    updatedAt: '2023-01-01T00:00:00Z',
  },
];

export function useAvatarLibrary(): UseAvatarLibraryResult {
  const [avatars, setAvatars] = useState<AvatarAsset[]>(LIBRARY_AVATARS);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Only return library avatars, not custom uploaded ones
      setAvatars(LIBRARY_AVATARS);
    } catch (err) {
      setAvatars(LIBRARY_AVATARS);
      setError(err instanceof Error ? err.message : 'Unable to load avatars');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { avatars, loading, error, refresh, setAvatars };
}
