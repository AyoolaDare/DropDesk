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
      backgroundSize: { dots: '18px 18px' },
      backgroundImage: {
        'anchor-cta': 'linear-gradient(120deg, #00806A 0%, #006652 55%, #004D3E 100%)',
        'kpi-glow': 'radial-gradient(60% 55% at 50% 40%, rgb(0 102 82 / 0.16), transparent 70%)',
        // Hero banner: deep teal sweep with a mint highlight top-right.
        'hero': 'radial-gradient(90% 120% at 100% 0%, rgb(52 211 153 / 0.38), transparent 55%), linear-gradient(120deg, #003D31 0%, #006652 55%, #0B8A70 100%)',
        'hero-dots': 'radial-gradient(rgb(255 255 255 / 0.14) 1px, transparent 1.2px)',
        // Page backdrop: two faint glows at the top, matte below.
        'page-mesh': 'radial-gradient(45% 60% at 0% 0%, rgb(16 185 129 / 0.12), transparent 70%), radial-gradient(40% 55% at 100% 0%, rgb(0 102 82 / 0.10), transparent 70%)',
        // 2D icon tiles
        'tile-teal': 'linear-gradient(135deg, #34D399 0%, #006652 100%)',
        'tile-sea': 'linear-gradient(135deg, #5EEAD4 0%, #0F766E 100%)',
        'tile-amber': 'linear-gradient(135deg, #FDBA74 0%, #D9480F 100%)',
        'tile-slate': 'linear-gradient(135deg, #CBD5E1 0%, #475569 100%)',
        'tile-violet': 'linear-gradient(135deg, #C4B5FD 0%, #6D28D9 100%)',
        'bar-anchor': 'linear-gradient(90deg, #34D399 0%, #006652 100%)',
        'bar-anchor-up': 'linear-gradient(0deg, #006652 0%, #34D399 100%)',
        'seg-pending': 'linear-gradient(90deg, #CBD5E1, #94A3B8)',
        'seg-transit': 'linear-gradient(90deg, #64748B, #475569)',
        'seg-attention': 'linear-gradient(90deg, #FB923C, #D9480F)',
        'seg-delivered': 'linear-gradient(90deg, #10B981, #006652)',
        'map-soft': 'linear-gradient(135deg, #ECFDF5 0%, #CCFBF1 60%, #A7F3D0 100%)',
      },
    },
  },
};
