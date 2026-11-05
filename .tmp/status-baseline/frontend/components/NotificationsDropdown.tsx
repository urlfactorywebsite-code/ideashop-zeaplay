import React from 'react';
import { motion } from 'framer-motion';
import { BellIcon, TrashIcon } from './icons';

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  time: string;
  icon?: React.ReactNode;
  onDelete?: () => void;
};

type NotificationsDropdownProps = {
  items: NotificationItem[];
  onItemClick?: (item: NotificationItem) => void;
};

const CLIP_PATH = 'polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px)';

const NotificationsDropdown: React.FC<NotificationsDropdownProps> = ({ items, onItemClick }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="w-80"
    >
      <div
        className="relative saber-pulse p-[1px] bg-[linear-gradient(90deg,#00ffff,#1e90ff)]"
        style={{ clipPath: CLIP_PATH }}
      >
        <div
          className="relative overflow-hidden bg-[#0b0e14] text-text-primary"
          style={{ clipPath: CLIP_PATH }}
        >
          <span className="pointer-events-none absolute left-2 top-2 h-3 w-3 border-l border-t border-cyan-300/70" />
          <span className="pointer-events-none absolute right-2 top-2 h-3 w-3 border-r border-t border-cyan-300/70" />
          <span className="pointer-events-none absolute left-2 bottom-2 h-3 w-3 border-l border-b border-cyan-300/70" />
          <span className="pointer-events-none absolute right-2 bottom-2 h-3 w-3 border-r border-b border-cyan-300/70" />

          <div className="relative flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-200">
                Notifications
              </span>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-300 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" />
              </span>
            </div>
            <div className="scan-line absolute left-4 right-4 bottom-0" />
          </div>

          <div className="max-h-96 overflow-y-auto px-3 pb-3">
            {items.length === 0 ? (
              <div className="rounded-xl border border-cyan-400/20 bg-slate-950/60 px-4 py-3 text-xs text-cyan-200/70">
                No new notifications.
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onItemClick?.(item)}
                    className="group w-full rounded-xl border border-cyan-400/20 bg-slate-950/60 px-3 py-3 text-left transition hover:border-cyan-300/60 hover:bg-cyan-500/10"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-400/30 bg-[#0b0e14] text-cyan-200 shadow-[0_0_8px_rgba(0,255,255,0.2)] transition group-hover:shadow-[0_0_14px_rgba(0,255,255,0.5)]">
                        {item.icon ?? <BellIcon className="h-5 w-5" />}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-text-primary">{item.title}</p>
                        <p className="mt-1 text-xs text-text-secondary line-clamp-2">{item.message}</p>
                        <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-amber-300">{item.time}</p>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          item.onDelete?.();
                        }}
                        className="mt-1 rounded-full p-1 text-fuchsia-400 transition hover:text-fuchsia-300 hover:shadow-[0_0_10px_rgba(236,72,153,0.6)]"
                        aria-label="Delete notification"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default NotificationsDropdown;
