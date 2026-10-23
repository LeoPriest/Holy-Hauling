/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Workday design tokens. Values live as CSS variables in index.css so
      // light and dark mode swap in one place.
      colors: {
        bg: 'var(--bg)', sf: 'var(--sf)', ink: 'var(--ink)', mu: 'var(--mu)', ln: 'var(--ln)', edge: 'var(--edge)',
        tint: 'var(--tint)', hd: 'var(--hd)', pr: '#1b6d60', ac: '#f4a623', ok: 'var(--ok)', danger: 'var(--red)',
      },
      fontFamily: { disp: ['"Barlow Condensed"', 'sans-serif'], body: ['Figtree', 'sans-serif'] },
      borderRadius: { badge: '6px', chip: '9px', card: '12px', panel: '16px', sheet: '22px' },
      transitionTimingFunction: { settle: 'cubic-bezier(.2,.9,.25,1.12)', out: 'cubic-bezier(.2,.8,.2,1)' },
    },
  },
  plugins: [],
}
