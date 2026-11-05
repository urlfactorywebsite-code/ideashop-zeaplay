import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Role } from '../types';
import MDEditor from '@uiw/react-md-editor';
import { XMarkIcon, PencilIcon } from './icons';

const DEFAULT_TABS = ['Overview', 'How to Use', 'FAQ'] as const;
const EMOJI_REACTIONS = [
  { emoji: '👍', label: 'Helpful' },
  { emoji: '❤️', label: 'Loved It' },
  { emoji: '😂', label: 'Made Me Laugh' },
  { emoji: '🤔', label: 'Interesting' },
  { emoji: '🔥', label: 'Awesome' },
] as const;

type EmojiSymbol = (typeof EMOJI_REACTIONS)[number]['emoji'];

interface TabContent {
  content: string;
}

interface DocsData {
  tabs: Record<string, TabContent>;
  order: string[];
  lastSaved: string;
}

type ReactionCounts = Record<EmojiSymbol, number>;
type ReactionLocks = Partial<Record<EmojiSymbol, boolean>>;

const buildDefaultTabs = (): Record<string, TabContent> =>
  DEFAULT_TABS.reduce((acc, tab) => {
    acc[tab] = { content: '' };
    return acc;
  }, {} as Record<string, TabContent>);

const buildInitialDocsData = (): DocsData => ({
  tabs: buildDefaultTabs(),
  order: [...DEFAULT_TABS],
  lastSaved: new Date().toISOString(),
});

const normalizeDocsData = (incoming?: Partial<DocsData>): DocsData => {
  if (!incoming) {
    return buildInitialDocsData();
  }

  const mergedTabs = { ...buildDefaultTabs(), ...(incoming.tabs || {}) };
  const baseOrder =
    incoming.order && incoming.order.length
      ? incoming.order
      : Object.keys(mergedTabs);

  const uniqueOrder = Array.from(
    new Set([...DEFAULT_TABS, ...baseOrder]),
  ).filter((tab) => tab && mergedTabs[tab]);

  return {
    tabs: mergedTabs,
    order: uniqueOrder.length ? uniqueOrder : [...DEFAULT_TABS],
    lastSaved: incoming.lastSaved || new Date().toISOString(),
  };
};

const buildDefaultReactionCounts = (): ReactionCounts =>
  EMOJI_REACTIONS.reduce((acc, { emoji }) => {
    acc[emoji] = 0;
    return acc;
  }, {} as ReactionCounts);

const TaskDocumentation: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const location = useLocation();
  const { user } = useAuth();
  const pageName = location.pathname || 'current page';
  const storageKey = `docs-${pageName}`;
  const reactionStorageKey = `docs-reactions-${pageName}`;
  const reactionLockKey = `docs-reactions-lock-${pageName}`;

  const canManageDocs =
    !!user && [Role.MANAGER, Role.ADMIN, Role.OWNER].includes(user.role);
  const isOwner = !!user && user.role === Role.OWNER;

  const [docsData, setDocsData] = useState<DocsData>(() => buildInitialDocsData());
  const [activeTab, setActiveTab] = useState<string>(DEFAULT_TABS[0]);
  const [isEditing, setIsEditing] = useState(false);
  const [hasHydratedDocs, setHasHydratedDocs] = useState(false);
  const [reactions, setReactions] = useState<ReactionCounts>(() =>
    buildDefaultReactionCounts(),
  );
  const [lockedReactions, setLockedReactions] = useState<ReactionLocks>({});
  const reactionsHydratedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    setHasHydratedDocs(false);
    const saved = window.localStorage.getItem(storageKey);
    let parsed: Partial<DocsData> | undefined;
    if (saved) {
      try {
        parsed = JSON.parse(saved);
      } catch {
        parsed = undefined;
      }
    }
    const resolved = normalizeDocsData(parsed);
    setDocsData(resolved);
    setActiveTab((prev) =>
      resolved.order.includes(prev) ? prev : resolved.order[0],
    );
    window.localStorage.setItem(storageKey, JSON.stringify(resolved));
    setHasHydratedDocs(true);
  }, [storageKey]);

  useEffect(() => {
    if (
      !isOpen ||
      !canManageDocs ||
      !isEditing ||
      !hasHydratedDocs ||
      typeof window === 'undefined'
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      setDocsData((prev) => {
        const timestamp = new Date().toISOString();
        const next = { ...prev, lastSaved: timestamp };
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    }, 10000);

    return () => window.clearInterval(interval);
  }, [isOpen, canManageDocs, isEditing, storageKey, hasHydratedDocs]);

  useEffect(() => {
    if (!hasHydratedDocs || typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(docsData));
  }, [docsData, storageKey, hasHydratedDocs]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const savedCounts = window.localStorage.getItem(reactionStorageKey);
    const savedLocks = window.localStorage.getItem(reactionLockKey);

    let parsedCounts: ReactionCounts | undefined;
    let parsedLocks: ReactionLocks | undefined;

    if (savedCounts) {
      try {
        parsedCounts = JSON.parse(savedCounts);
      } catch {
        parsedCounts = undefined;
      }
    }

    if (savedLocks) {
      try {
        parsedLocks = JSON.parse(savedLocks);
      } catch {
        parsedLocks = undefined;
      }
    }

    setReactions(
      parsedCounts ? { ...buildDefaultReactionCounts(), ...parsedCounts } : buildDefaultReactionCounts(),
    );
    setLockedReactions(parsedLocks || {});
    reactionsHydratedRef.current = true;
  }, [reactionStorageKey, reactionLockKey]);

  useEffect(() => {
    if (!reactionsHydratedRef.current || typeof window === 'undefined') {
      return;
    }
    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(
        reactionStorageKey,
        JSON.stringify(reactions),
      );
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [reactions, reactionStorageKey]);

  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentTabContent = docsData.tabs[activeTab]?.content ?? '';
  const lastUpdatedLabel = docsData.lastSaved
    ? new Date(docsData.lastSaved).toLocaleString()
    : 'Not yet saved';

  const handleContentChange = (content: string) => {
    setDocsData((prev) => ({
      ...prev,
      tabs: {
        ...prev.tabs,
        [activeTab]: { content },
      },
    }));
  };

  const handleManualSave = () => {
    if (!canManageDocs || typeof window === 'undefined') {
      return;
    }
    const timestamp = new Date().toISOString();
    const next = { ...docsData, lastSaved: timestamp };
    setDocsData(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    setIsEditing(false);
  };

  const handleAddTab = () => {
    if (!isOwner || typeof window === 'undefined') {
      return;
    }
    const rawName = window.prompt('Name your new tab');
    const trimmed = rawName?.trim();
    if (!trimmed) {
      return;
    }
    const sanitized = trimmed.slice(0, 40);
    const alreadyExists = !!docsData.tabs[sanitized];

    if (!alreadyExists) {
      setDocsData((prev) => ({
        ...prev,
        tabs: { ...prev.tabs, [sanitized]: { content: '' } },
        order: prev.order.includes(sanitized)
          ? prev.order
          : [...prev.order, sanitized],
      }));
    }

    setActiveTab(sanitized);
    setIsEditing(true);
  };

  const handleReaction = (emoji: EmojiSymbol) => {
    if (lockedReactions[emoji]) {
      return;
    }

    setReactions((prev) => ({
      ...prev,
      [emoji]: (prev[emoji] || 0) + 1,
    }));

    setLockedReactions((prev) => {
      const updated = { ...prev, [emoji]: true };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(reactionLockKey, JSON.stringify(updated));
      }
      return updated;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1200px] max-h-[90vh] overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-gray-900/95 via-black/80 to-gray-900/90 text-gray-100 shadow-2xl shadow-black/70"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-white/10 px-8 py-6">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-gray-500">
                📘 User Manual · {pageName}
              </p>
              <p className="mt-2 text-sm text-gray-400">
                Support guide and best practices for using this page.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-gray-300 transition hover:text-white"
              aria-label="Close manual"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </header>

          <div className="flex flex-1 flex-col gap-8 overflow-y-auto px-8 py-6 md:flex-row">
            <div className="flex-1 min-w-0 space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                {docsData.order.map((tab) => {
                  const isActive = tab === activeTab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                        isActive
                          ? 'border-[#d4af37]/60 bg-[#d4af37]/15 text-[#d4af37] shadow-[0_10px_40px_rgba(0,0,0,0.35)]'
                          : 'border-white/10 bg-white/5 text-gray-300 hover:border-[#d4af37]/40 hover:text-white'
                      }`}
                    >
                      {tab}
                    </button>
                  );
                })}
                {isOwner && (
                  <button
                    type="button"
                    onClick={handleAddTab}
                    className="rounded-full border border-dashed border-[#d4af37]/60 px-4 py-2 text-sm font-semibold text-[#d4af37] transition hover:bg-[#d4af37]/10"
                  >
                    ➕ Add Tab
                  </button>
                )}
              </div>

              <div
                className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-inner shadow-black/40"
                data-color-mode="dark"
              >
                {isEditing && canManageDocs ? (
                  <MDEditor
                    value={currentTabContent}
                    onChange={(value) => handleContentChange(value || '')}
                    preview="edit"
                    height={360}
                    textareaProps={{
                      placeholder: `Add guidance for ${activeTab}...`,
                    }}
                    fullscreen={false}
                    className="bg-transparent text-gray-100"
                  />
                ) : (
                  <div className="prose prose-invert max-w-none text-sm leading-relaxed text-gray-200">
                    <MDEditor.Markdown
                      source={
                        currentTabContent ||
                        'Nothing here yet. Switch to edit to add guidance.'
                      }
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-center md:block md:flex-shrink-0">
              <div className="flex h-[320px] w-full max-w-sm flex-col items-center justify-center rounded-[28px] border border-dashed border-white/20 bg-gradient-to-br from-white/5 to-white/0 text-center text-sm text-gray-400 shadow-inner shadow-black/50 md:h-[500px] md:w-[400px] md:min-w-[400px]">
                <div className="text-5xl">🖼️</div>
                <p className="mt-4 px-6 leading-relaxed">
                  Reserved for future support illustrations or Lottie animations
                  (400 × 500 px).
                </p>
              </div>
            </div>
          </div>

          <footer className="border-t border-white/10 px-8 py-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {canManageDocs ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setIsEditing((prev) => !prev)}
                      className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                        isEditing
                          ? 'border-[#d4af37]/60 bg-[#d4af37]/15 text-[#d4af37]'
                          : 'border-white/15 bg-white/5 text-gray-200 hover:border-[#d4af37]/40'
                      }`}
                    >
                      <PencilIcon className="h-4 w-4" />
                      {isEditing ? 'Exit Edit Mode' : 'Edit Content'}
                    </button>
                    <button
                      type="button"
                      onClick={handleManualSave}
                      disabled={!isEditing}
                      className={`rounded-full px-6 py-2 text-sm font-semibold transition ${
                        isEditing
                          ? 'bg-[#d4af37] text-gray-900 shadow-lg shadow-[#d4af37]/40 hover:bg-[#d4af37]/90'
                          : 'bg-gray-700 text-gray-400 cursor-not-allowed opacity-60'
                      }`}
                    >
                      Save Manual
                    </button>
                  </div>
                  <div className="text-xs text-gray-400">
                    Last updated {lastUpdatedLabel}
                  </div>
                </>
              ) : (
                <div className="text-xs text-gray-400">
                  View-only access · Last updated {lastUpdatedLabel}
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {EMOJI_REACTIONS.map(({ emoji, label }) => {
                const isLocked = !!lockedReactions[emoji];
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleReaction(emoji)}
                    disabled={isLocked}
                    title={`${emoji} = ${label}`}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-base transition ${
                      isLocked
                        ? 'border-[#d4af37]/40 bg-[#d4af37]/20 text-[#d4af37]'
                        : 'border-white/15 bg-white/5 text-gray-200 hover:border-[#d4af37]/40 hover:text-[#d4af37]'
                    }`}
                  >
                    <span>{emoji}</span>
                    <span className="rounded-full bg-black/40 px-2 text-xs font-semibold">
                      {reactions[emoji] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              👍 Helpful · ❤️ Loved It · 😂 Made Me Laugh · 🤔 Interesting · 🔥 Awesome
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default TaskDocumentation;
