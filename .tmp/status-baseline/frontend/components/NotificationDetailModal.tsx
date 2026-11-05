import React from 'react';
import { Notification } from '../types';
import { timeAgo } from '../utils';
import { XMarkIcon } from './icons';

interface NotificationDetailModalProps {
  notification: Notification | null;
  isOpen: boolean;
  onClose: () => void;
}

const NotificationDetailModal: React.FC<NotificationDetailModalProps> = ({
  notification,
  isOpen,
  onClose,
}) => {
  if (!notification || !isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-border-color bg-surface p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1 text-text-secondary hover:bg-white/10"
          aria-label="Close notification details"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
        <p className="text-xs uppercase tracking-wide text-text-secondary">Notification</p>
        <h2 className="mt-2 text-lg font-semibold text-white">
          {notification.title || notification.message}
        </h2>
        {notification.body && (
          <p className="mt-2 text-sm text-text-secondary">{notification.body}</p>
        )}
        <p className="mt-4 text-sm text-text-secondary">
          Received {timeAgo(notification.createdAt)}
        </p>
      </div>
    </div>
  );
};

export default NotificationDetailModal;
