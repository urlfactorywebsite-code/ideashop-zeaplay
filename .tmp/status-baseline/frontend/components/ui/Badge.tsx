import React from 'react';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  color: 'blue' | 'green' | 'yellow' | 'red' | 'gray' | 'purple';
  children: React.ReactNode;
}

const baseClasses =
  'group inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5';

const palette = {
  blue: {
    token: '--color-info',
    text: 'var(--color-text-primary)',
  },
  green: {
    token: '--color-priority-low',
    text: 'var(--color-text-primary)',
  },
  yellow: {
    token: '--color-priority-medium',
    text: 'var(--color-text-primary)',
  },
  red: {
    token: '--color-priority-high',
    text: 'var(--color-text-primary)',
  },
  gray: {
    token: '--color-stage-graveyard',
    text: 'var(--color-text-primary)',
  },
  purple: {
    token: '--color-priority-urgent',
    text: 'var(--color-text-primary)',
  },
} as const;

const Badge: React.FC<BadgeProps> = ({ color, children, className = '', style, ...rest }) => {
  const paletteEntry = palette[color] ?? palette.blue;
  const mergedStyle: React.CSSProperties = {
    borderColor: `color-mix(in srgb, var(${paletteEntry.token}) 60%, var(--color-border-color) 40%)`,
    background: `linear-gradient(120deg, color-mix(in srgb, var(${paletteEntry.token}) 32%, var(--color-surface) 68%), color-mix(in srgb, var(${paletteEntry.token}) 22%, var(--color-bg-secondary) 78%))`,
    color: paletteEntry.text,
    boxShadow: `0 12px 24px color-mix(in srgb, var(${paletteEntry.token}) 28%, transparent)`,
    ...(style as React.CSSProperties | undefined),
  };

  return (
    <span
      {...rest}
      className={`relative overflow-hidden ${baseClasses} ${className}`.trim()}
      style={mergedStyle}
    >
      <span className="relative z-10 drop-shadow-sm">{children}</span>
      <span className="pointer-events-none absolute inset-0 bg-white/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
    </span>
  );
};

export default Badge;
