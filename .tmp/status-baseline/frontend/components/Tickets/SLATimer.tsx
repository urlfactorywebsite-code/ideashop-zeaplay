import React, { useEffect, useState } from 'react';
import { ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Ticket } from '../../types';

interface SLATimerProps {
  ticket: Ticket;
}

const SLATimer: React.FC<SLATimerProps> = ({ ticket }) => {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isOverdue, setIsOverdue] = useState(false);

  useEffect(() => {
    const calculateTimeLeft = () => {
      if (!ticket.resolutionDueAt) return null;

      const dueDate = new Date(ticket.resolutionDueAt);
      const now = new Date();
      const diffMs = dueDate.getTime() - now.getTime();

      if (diffMs <= 0) {
        setIsOverdue(true);
        return Math.abs(Math.floor(diffMs / (1000 * 60))); // minutes overdue
      }

      setIsOverdue(false);
      return Math.floor(diffMs / (1000 * 60)); // minutes left
    };

    const updateTimer = () => {
      setTimeLeft(calculateTimeLeft());
    };

    updateTimer();
    const interval = setInterval(updateTimer, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [ticket.resolutionDueAt]);

  const formatTime = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  if (timeLeft === null) {
    return null;
  }

  return (
    <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-medium ${
      isOverdue
        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
        : timeLeft < 60
        ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300'
        : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
    }`}>
      {isOverdue ? (
        <ExclamationTriangleIcon className="h-4 w-4" />
      ) : (
        <ClockIcon className="h-4 w-4" />
      )}
      <span>
        {isOverdue ? `Overdue ${formatTime(timeLeft)}` : `${formatTime(timeLeft)} left`}
      </span>
    </div>
  );
};

export default SLATimer;
