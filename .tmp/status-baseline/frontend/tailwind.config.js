/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: {
    relative: true,
    files: [
      './index.html', './*.{js,jsx,ts,tsx}',
      './{components,constants,features,hooks,pages,services,types,utils}/**/*.{js,jsx,ts,tsx}',
    ],
  },
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        'primary-dark': 'var(--color-primary-dark)',
        background: 'var(--color-background)',
        surface: 'var(--color-surface)',
        'border-color': 'var(--color-border-color)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted': 'var(--color-text-muted)',
        'text-accent': 'var(--color-text-accent)',
        'text-inverted': 'var(--color-text-inverted)',
        'text-warning': 'var(--color-text-warning)',
        'text-success': 'var(--color-text-success)',
        danger: 'var(--color-danger)',
        dark: { bg1: '#1e1b4b', bg2: '#4c1d95', bg3: '#831843', accent: '#ec4899' },
        light: { bg1: '#fef3c7', bg2: '#fed7aa', text: '#78350f' },
        colorful: { bg1: '#d946ef', bg2: '#38bdf8', bg3: '#8b5cf6', text: '#000000' },
        accent: { teal: '#14b8a6', orange: '#fb923c', violet: '#8b5cf6' },
      },
    },
  },
  plugins: [],
};
