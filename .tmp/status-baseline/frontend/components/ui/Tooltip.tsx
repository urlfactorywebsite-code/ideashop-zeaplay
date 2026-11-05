import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  /** The text to display in the tooltip */
  text: string;
  /** The content to hover over */
  children: React.ReactNode;
  /** Optional CSS classes for the tooltip box */
  className?: string;
  /** Optional CSS classes for the trigger */
  triggerClassName?: string;
}

/**
 * A reusable tooltip component that displays on hover.
 * Features:
 * - Appears above the hovered element
 * - Smooth fade-in transition
 * - Accessible with proper ARIA attributes
 * - Styled with Tailwind CSS
 */
const Tooltip: React.FC<TooltipProps> = ({ text, children, className, triggerClassName }) => {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setCoords({
      left: rect.left + rect.width / 2,
      top: rect.top - 40,
    });
  }, []);

  useEffect(() => {
    if (!isVisible || typeof window === 'undefined') return;
    updatePosition();
    const handleScroll = () => updatePosition();
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isVisible, updatePosition]);

  const showTooltip = () => setIsVisible(true);
  const hideTooltip = () => setIsVisible(false);

  const tooltipNode =
    isVisible && coords && typeof document !== 'undefined'
      ? createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            className={`
              pointer-events-none fixed left-0 top-0 -translate-x-1/2 -translate-y-full
              opacity-0 translate-y-2 scale-95 transition-all duration-150 ease-out
              data-[show=true]:opacity-100 data-[show=true]:translate-y-0 data-[show=true]:scale-100
              z-[200] ${className ?? ''}
            `}
            style={{ left: coords.left, top: coords.top }}
            data-show={isVisible}
          >
            <span className="absolute -inset-1 rounded-lg bg-cyan-400/20 blur-md" aria-hidden="true" />
            <span className="relative block whitespace-nowrap rounded-lg border border-cyan-300/70 bg-slate-950/95 px-3 py-1.5 text-xs font-semibold text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.55)]">
              {text}
              <span
                className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-px h-2.5 w-2.5 rotate-45 border border-cyan-300/70 bg-slate-950/95 shadow-[0_0_10px_rgba(34,211,238,0.45)]"
                aria-hidden="true"
              />
            </span>
          </span>,
          document.body,
        )
      : null;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      <span
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={tooltipId}
        className={`outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70 ${triggerClassName ?? ''}`}
      >
        {children}
      </span>
      {tooltipNode}
    </span>
  );
};

export default Tooltip;
