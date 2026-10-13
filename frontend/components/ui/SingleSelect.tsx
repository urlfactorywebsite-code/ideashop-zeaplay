import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

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
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [menuMaxHeight, setMenuMaxHeight] = useState(192);
  const containerRef = useRef<HTMLDivElement>(null);

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

    const rect = containerRef.current.getBoundingClientRect();
    const viewportPadding = 20;
    const preferredHeight = 224;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const shouldDropUp = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableSpace = shouldDropUp ? spaceAbove : spaceBelow;

    setDropUp(shouldDropUp);
    setMenuMaxHeight(Math.max(144, Math.min(224, availableSpace)));
  }, [isOpen, options.length]);

  const selectedOption = options.find((opt) => opt.id === value);

  const handleToggle = () => {
    if (disabled) return;
    setIsOpen((prev) => !prev);
  };

  const handleSelect = (optionId: string) => {
    onChange(optionId);
    setIsOpen(false);
  };

  const label = selectedOption?.name ?? "";

  return (
    <div ref={containerRef} className={`relative ${isOpen ? "z-[80]" : "z-0"} ${className}`}>
      <button
        type="button"
        id={id}
        onClick={handleToggle}
        disabled={disabled}
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
