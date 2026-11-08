/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /*
       * Color meanings are fixed across the app:
       *   accent  blue    – actions, selection, "in progress"
       *   hiker   orange  – the missing person (LKP, subject markers)
       *   ok      green   – found / healthy / complete
       *   warn    gold    – waiting on someone, needs attention soon
       *   crit    rose    – urgent: potential detection, low battery
       *   (violet is reserved for the search-probability heatmap)
       */
      colors: {
        night: '#0E1726',
        night2: '#18243A',
        base: '#F3F5F9',
        base2: '#EBEFF5',
        panel: '#FFFFFF',
        elevated: '#F1F4F9',
        line: '#E1E6EE',
        accent: '#2556E8',
        info: '#2556E8',
        hiker: '#F26B1D',
        ok: '#0E9F6E',
        warn: '#C88A04',
        crit: '#E5364B',
        ink: '#101828',
        muted: '#5F6B7D',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      fontSize: { '2xs': ['10px', '14px'] },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
        float: '0 8px 24px rgba(16,24,40,0.12), 0 2px 6px rgba(16,24,40,0.06)',
      },
      keyframes: {
        pulseRing: { '0%': { transform: 'scale(0.6)', opacity: '0.9' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
        slideIn: { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        scan: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        pulseRing: 'pulseRing 1.8s ease-out infinite',
        slideIn: 'slideIn 0.25s ease-out',
        fadeIn: 'fadeIn 0.3s ease-out',
        scan: 'scan 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};
