/** DropDesk responsive UI tokens. Breakpoints: base = mobile (360+), md = tablet (768+), lg = laptop (1024+), 2xl = wide (1536–1920). */
module.exports = {
  content: ['./*.html'],
  theme: {
    extend: {
      colors: {
        surface: '#F8FAFC',        // slate-50 page background
        ink: '#0F172A',            // slate-900 text
        verified: { DEFAULT: '#15803D', dark: '#166534', tint: '#F0FDF4', line: '#BBF7D0' }, // green-700
        attention: { DEFAULT: '#B45309', dark: '#92400E', tint: '#FFFBEB', line: '#FCD34D' }, // amber-700
        transit: { DEFAULT: '#1D4ED8', tint: '#EFF6FF', line: '#BFDBFE' },
        danger: { DEFAULT: '#B91C1C', tint: '#FEF2F2', line: '#FECACA' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { DEFAULT: '4px', sm: '2px' },
      boxShadow: { card: '0 1px 2px rgb(15 23 42 / 0.06)', float: '0 8px 24px rgb(15 23 42 / 0.12)' },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
    },
  },
};
