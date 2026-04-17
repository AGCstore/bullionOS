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
