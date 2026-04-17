import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Private-banking-style palette: deep graphite + gold accent.
        ink: {
          50:  '#f7f7f8',
          100: '#eeeef1',
          200: '#d9d9de',
          400: '#8a8a92',
          600: '#55555c',
          800: '#26262b',
          900: '#17171a',
        },
        gold: {
          500: '#c9a96a',
          600: '#b08e4a',
        },
        // Semantic tints for buy-side (money-out, navy) and sell-side
        // (money-in, green) screens. Kept subtle — the numbers still
        // dominate; the hue just helps operators recognize context at a
        // glance. Invoice PDFs stay monochrome and are unaffected.
        buy: {
          50:  '#e6edf7', // slightly darker than a pastel — reads "navy"
          100: '#d4dff0',
          200: '#a8bddc',
          600: '#1e3a78',
          700: '#152c5e',
        },
        sell: {
          50:  '#e8f3ec', // light hue over a darker-green base
          100: '#d2e7d9',
          200: '#9ecdaf',
          600: '#1f6b3e',
          700: '#175130',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
