import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

interface Option {
  id: string;
  name: string;
}

interface SingleSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean, id?: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  avoidClipping?: boolean;
}

const SingleSelect: React.FC<SingleSelectProps> = ({
  options,
  value,
  onChange,
  onOpenChange,
  placeholder = "Select...",
  className = "",
  id,
  disabled = false,
  avoidClipping = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [menuMaxHeight, setMenuMaxHeight] = useState(192);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (onOpenChange) {
      onOpenChange(isOpen, id);
    }
  }, [id, isOpen, onOpenChange]);

  useLayoutEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const position = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const viewportPadding = 20;
    const preferredHeight = 224;
    let top = viewportPadding, bottom = window.innerHeight - viewportPadding;
    if (avoidClipping) for (let parent = containerRef.current.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
        const bounds = parent.getBoundingClientRect();
        top = Math.max(top, bounds.top + 8); bottom = Math.min(bottom, bounds.bottom - 8);
      }
    }
    const spaceBelow = bottom - rect.bottom - 8;
    const spaceAbove = rect.top - top - 8;
    const shouldDropUp = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableSpace = shouldDropUp ? spaceAbove : spaceBelow;

    setDropUp(shouldDropUp);
    setMenuMaxHeight(Math.max(avoidClipping ? 0 : 144, Math.min(224, availableSpace)));
    };
    position();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true); };
  }, [isOpen, options.length, avoidClipping]);

  const selectedOption = options.find((opt) => opt.id === value);

  const handleToggle = () => {
    if (disabled) return;
    setIsOpen((prev) => !prev);
  };

  const handleSelect = (optionId: string) => {
    onChange(optionId);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const label = selectedOption?.name ?? "";

  return (
    <div ref={containerRef} className={`relative ${isOpen ? "z-[80]" : "z-0"} ${className}`}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsOpen(false); }}
      onKeyDown={event => {
        if (disabled) return;
        if (isOpen && event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); setIsOpen(false); triggerRef.current?.focus();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const wasOpen = isOpen;
          setIsOpen(true);
          window.requestAnimationFrame(() => {
            const items = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
            let index = items.indexOf(document.activeElement as HTMLButtonElement);
            index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
              : !wasOpen ? Math.max(0, options.findIndex(option => option.id === value))
              : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
            items[index]?.focus();
          });
        }
      }}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        onClick={handleToggle}
        disabled={disabled}
        aria-haspopup="listbox" aria-expanded={isOpen} aria-controls={isOpen ? menuId : undefined}
        className={`modal-input flex w-full items-center justify-between gap-3 border text-left text-sm transition duration-150 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
      >
        <span style={{ color: label ? "inherit" : "var(--modal-placeholder)" }}>
          {label || placeholder}
        </span>
        <svg
          className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          style={{ color: 'var(--modal-muted)' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          id={menuId} role="listbox" aria-labelledby={id}
          className={`modal-dropdown-panel absolute left-0 z-[90] w-full overflow-y-auto ${
            dropUp ? "bottom-full mb-2" : "top-full mt-2"
          }`}
          style={{ maxHeight: menuMaxHeight }}
        >
          {options.map((opt) => {
            const isSelected = opt.id === value;
            return (
              <button
                key={opt.id}
                type="button"
                role="option" aria-selected={isSelected} tabIndex={-1}
                onClick={() => handleSelect(opt.id)}
                className={`modal-dropdown-item ${isSelected ? "is-selected" : ""}`}
              >
                {opt.name}
              </button>
            );
          })}
          {options.length === 0 && (
            <div className="px-4 py-2 text-sm" style={{ color: 'var(--modal-muted)' }}>No options available</div>
          )}
        </div>
      )}
    </div>
  );
};

export default SingleSelect;
