/** DropDesk merchant workspace: light, neutral-first, one anchor accent (#006652). */
module.exports = {
  content: ['./*.html'],
  theme: {
    extend: {
      colors: {
        canvas: '#F7F8F7',                 // matte off-white backdrop
        ink: { DEFAULT: '#0F172A', soft: '#334155', muted: '#64748B' },
        anchor: { DEFAULT: '#006652', dark: '#004D3E', light: '#0B8A70', soft: '#E7F2EF', line: '#B7D9D0' },
        stage: { pending: '#94A3B8', transit: '#475569', attention: '#D9480F', delivered: '#006652' },
        alert: { DEFAULT: '#B42318', soft: '#FEF3F2', line: '#F7C1BC' },
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        hairline: '0 1px 2px rgb(15 23 42 / 0.04)',
        lift: '0 8px 24px -12px rgb(15 23 42 / 0.12)',
        sheet: '0 24px 48px -16px rgb(15 23 42 / 0.18)',
      },
      backgroundImage: {
        'anchor-cta': 'linear-gradient(120deg, #00806A 0%, #006652 55%, #004D3E 100%)',
        'kpi-glow': 'radial-gradient(60% 55% at 50% 40%, rgb(0 102 82 / 0.12), transparent 70%)',
      },
    },
  },
};
