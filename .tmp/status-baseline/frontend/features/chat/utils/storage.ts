export const CHAT_STORAGE_LIMIT_BYTES = 200 * 1024 * 1024;

export interface ChatStorageFile {
  id: string;
  original_file_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  attached: boolean;
}

export interface ChatStorage {
  used_bytes: number;
  limit_bytes: number;
  remaining_bytes: number;
  max_file_bytes: number;
  file_count: number;
  items: ChatStorageFile[];
  has_more: boolean;
}

export class ChatStorageQuotaError extends Error {
  constructor(message = 'Your 200 MB chat storage limit would be exceeded. Clean up storage to upload this file.') {
    super(message);
    this.name = 'ChatStorageQuotaError';
  }
}

export const formatStorageMB = (bytes: number): string => bytes > 0 && bytes < 0.01 * 1024 * 1024
  ? '<0.01 MB'
  : `${(bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB`;
export const isProtectedChatFile = (url?: string | null): url is string => Boolean(url && /^\/chat\/(?:uploads|attachments)\/[a-zA-Z0-9-]+\/content$/.test(url));
