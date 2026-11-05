import { User } from '../types';

export type MentionMatch = {
  query: string;
  start: number;
  end: number;
};

const normalizeToken = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

export const getMentionMatch = (value: string, cursor: number): MentionMatch | null => {
  const beforeCursor = value.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf('@');
  if (atIndex < 0) return null;
  if (atIndex > 0 && !/\s/.test(beforeCursor[atIndex - 1])) return null;

  const query = beforeCursor.slice(atIndex + 1);
  if (!query || /\s/.test(query)) return null;

  return { query, start: atIndex, end: cursor };
};

export const applyMention = (value: string, match: MentionMatch, mention: string) => {
  const before = value.slice(0, match.start);
  const after = value.slice(match.end);
  return `${before}@${mention} ${after}`.replace(/\s{2,}/g, ' ');
};

export const extractMentionedUserIds = (value: string, users: User[]): string[] => {
  const mentionMatches = value.match(/@([\\w.-]+)/g) ?? [];
  const normalizedUsers = users.map((user) => {
    const nameToken = normalizeToken(user.name);
    const emailToken = normalizeToken(user.email.split('@')[0] ?? '');
    return { user, nameToken, emailToken };
  });

  const mentionedIds = new Set<string>();
  mentionMatches.forEach((raw) => {
    const token = normalizeToken(raw.replace('@', ''));
    const match = normalizedUsers.find(
      (candidate) => candidate.nameToken === token || candidate.emailToken === token,
    );
    if (match) {
      mentionedIds.add(match.user.id);
    }
  });

  return Array.from(mentionedIds);
};
