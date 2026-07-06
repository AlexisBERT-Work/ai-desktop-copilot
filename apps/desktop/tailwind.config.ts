import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // CatDesk brand palette
        brand: {
          50: '#f5f0ff',
          100: '#ede0ff',
          200: '#dbc5ff',
          300: '#c09aff',
          400: '#a16ef4',
          500: '#8b47e8',
          600: '#7a2fd4',
          700: '#6622b0',
          800: '#551e90',
          900: '#471c76',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        // Entrée des widgets du dashboard — `both` pour que animation-delay
        // (cascade) garde l'élément invisible avant son tour.
        'widget-enter': 'slideUp 0.3s ease-out both',
        // Micro-pulsation d'une valeur qui vient de changer (cours, KPI).
        'value-tick': 'valueTick 0.45s ease-out',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        valueTick: {
          from: { opacity: '0.35', transform: 'translateY(3px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
