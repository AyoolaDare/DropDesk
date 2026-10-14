/** Shares tokens with design/workspace (v3). */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F7F8F7',
        ink: { DEFAULT: '#0F172A', soft: '#334155', muted: '#64748B' },
        anchor: { DEFAULT: '#006652', dark: '#004D3E', soft: '#E7F2EF', line: '#B7D9D0' },
        alert: { DEFAULT: '#B42318', soft: '#FEF3F2', line: '#F7C1BC' },
      },
      fontFamily: { sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['"Geist Mono"', 'ui-monospace', 'monospace'] },
      boxShadow: { hairline: '0 1px 2px rgb(15 23 42 / 0.04)' },
      backgroundImage: {
        hero: 'radial-gradient(90% 120% at 100% 0%, rgb(52 211 153 / 0.38), transparent 55%), linear-gradient(120deg, #003D31 0%, #006652 55%, #0B8A70 100%)',
        'page-mesh': 'radial-gradient(45% 60% at 0% 0%, rgb(16 185 129 / 0.12), transparent 70%), radial-gradient(40% 55% at 100% 0%, rgb(0 102 82 / 0.10), transparent 70%)',
        'tile-teal': 'linear-gradient(135deg, #34D399 0%, #006652 100%)',
      },
    },
  },
};
