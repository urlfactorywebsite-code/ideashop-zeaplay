import { Role } from '../../../types';
import type { ChatAttachment, ChatMessage, ChatMessageType, ChatReaction } from '../types';

type Dict = Record<string, unknown>;

const isObject = (value: unknown): value is Dict => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const get = (source: Dict, ...keys: string[]) => {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
};

const stringValue = (value: unknown, fallback = ''): string => (
  typeof value === 'string' ? value : value === null || value === undefined ? fallback : String(value)
);

const nullableString = (value: unknown, fallback: string | null = null): string | null => {
  if (value === null || value === undefined || value === '') return fallback;
  return stringValue(value, fallback ?? '');
};

const numberValue = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const dateValue = (value: unknown, fallback?: string | null): string => {
  const raw = stringValue(value, fallback ?? '');
  if (!raw) return new Date().toISOString();
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? new Date().toISOString() : raw;
};

const roleValue = (value: unknown, fallback = Role.USER): Role => {
  const raw = stringValue(value, fallback);
  return Object.values(Role).includes(raw as Role) ? raw as Role : fallback;
};

const messageTypeValue = (value: unknown, fallback: ChatMessageType = 'TEXT'): ChatMessageType => {
  const raw = stringValue(value, fallback).toUpperCase();
  return ['TEXT', 'IMAGE', 'FILE', 'SYSTEM'].includes(raw) ? raw as ChatMessageType : fallback;
};

const normalizeReaction = (reaction: unknown): ChatReaction => {
  const raw = isObject(reaction) ? reaction : {};
  return {
    id: stringValue(get(raw, 'id'), `reaction-${Math.random().toString(36).slice(2)}`),
    messageId: stringValue(get(raw, 'messageId', 'message_id')),
    userId: stringValue(get(raw, 'userId', 'user_id')),
    emoji: stringValue(get(raw, 'emoji'), ''),
    createdAt: dateValue(get(raw, 'createdAt', 'created_at')),
  };
};

const normalizeAttachment = (attachment: unknown): ChatAttachment => {
  const raw = isObject(attachment) ? attachment : {};
  const storageKey = stringValue(get(raw, 'storageKey', 'storage_key', 'key'));
  const fileName = stringValue(get(raw, 'fileName', 'file_name', 'name', 'originalFileName', 'original_file_name'), 'Attachment');
  return {
    id: stringValue(get(raw, 'id'), storageKey || `attachment-${Math.random().toString(36).slice(2)}`),
    messageId: stringValue(get(raw, 'messageId', 'message_id')),
    fileName,
    originalFileName: stringValue(get(raw, 'originalFileName', 'original_file_name', 'fileName', 'file_name', 'name'), fileName),
    mimeType: stringValue(get(raw, 'mimeType', 'mime_type', 'contentType', 'content_type'), 'application/octet-stream'),
    fileSize: numberValue(get(raw, 'fileSize', 'file_size', 'size'), 0),
    storageKey,
    url: nullableString(get(raw, 'url', 'downloadUrl', 'download_url')),
    createdAt: dateValue(get(raw, 'createdAt', 'created_at')),
  };
};

export function normalizeMessage(rawMessage: unknown, fallback: Partial<ChatMessage> = {}): ChatMessage {
  const raw = isObject(rawMessage) ? rawMessage : {};
  const sender = isObject(get(raw, 'sender')) ? get(raw, 'sender') as Dict : {};
  const attachments = Array.isArray(get(raw, 'attachments')) ? (get(raw, 'attachments') as unknown[]).map(normalizeAttachment) : fallback.attachments ?? [];
  const senderId = stringValue(get(raw, 'senderId', 'sender_id', 'userId', 'user_id') ?? get(sender, 'id'), fallback.senderId ?? '');
  const senderName = stringValue(get(raw, 'senderName', 'sender_name', 'senderDisplayName') ?? get(sender, 'name', 'displayName', 'email'), fallback.senderName ?? 'Unknown User');
  const createdAt = dateValue(get(raw, 'createdAt', 'created_at'), fallback.createdAt);
  const messageType = messageTypeValue(get(raw, 'messageType', 'message_type', 'type'), fallback.messageType ?? (attachments.length > 0 ? 'FILE' : 'TEXT'));
  const deliveryStatus = nullableString(get(raw, 'deliveryStatus', 'delivery_status', 'status'), fallback.deliveryStatus ?? null) as ChatMessage['deliveryStatus'] | null;

  const message: ChatMessage = {
    id: stringValue(get(raw, 'id', 'messageId', 'message_id'), fallback.id ?? `message-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    clientId: nullableString(get(raw, 'clientId', 'client_id'), fallback.clientId ?? null),
    conversationId: stringValue(get(raw, 'conversationId', 'conversation_id', 'roomId', 'room_id'), fallback.conversationId ?? ''),
    senderId,
    senderName,
    senderRole: roleValue(get(raw, 'senderRole', 'sender_role', 'role') ?? get(sender, 'role'), fallback.senderRole),
    sender: {
      id: senderId,
      name: senderName,
      avatarUrl: nullableString(get(sender, 'avatarUrl', 'avatar_url', 'profileImageUrl', 'profile_image_url')),
    },
    messageType,
    content: stringValue(get(raw, 'content', 'text', 'message'), fallback.content ?? ''),
    replyToMessageId: nullableString(get(raw, 'replyToMessageId', 'reply_to_message_id') ?? (isObject(get(raw, 'replyTo', 'reply_to')) ? get(get(raw, 'replyTo', 'reply_to') as Dict, 'id') : undefined), fallback.replyToMessageId ?? null),
    editedAt: nullableString(get(raw, 'editedAt', 'edited_at'), fallback.editedAt ?? null),
    deletedAt: nullableString(get(raw, 'deletedAt', 'deleted_at'), fallback.deletedAt ?? null),
    createdAt,
    updatedAt: dateValue(get(raw, 'updatedAt', 'updated_at'), fallback.updatedAt ?? createdAt),
    reactions: Array.isArray(get(raw, 'reactions')) ? (get(raw, 'reactions') as unknown[]).map(normalizeReaction) : fallback.reactions ?? [],
    attachments,
    mentions: Array.isArray(get(raw, 'mentions')) ? (get(raw, 'mentions') as unknown[]).map((mention) => stringValue(isObject(mention) ? get(mention, 'id', 'userId', 'user_id', 'name') : mention)).filter(Boolean) : fallback.mentions ?? [],
  };
  if (deliveryStatus) {
    message.deliveryStatus = deliveryStatus;
  }
  return message;
}
