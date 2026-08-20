/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: { accent: { DEFAULT: '#1ea7ff', glow: '#6366f1' } },
      backdropBlur: { glass: '24px' },
    },
  },
  plugins: [],
};
