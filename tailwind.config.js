/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        pink: {
          50: '#fff0f6',
          100: '#ffe4ef',
          200: '#ffc9e0',
          300: '#ffa0c8',
          400: '#ff6dab',
          500: '#ff3d8e',
          600: '#f01870',
          700: '#d00a5c',
          800: '#ad0c4f',
          900: '#900e45',
        },
        sakura: {
          light: '#fff5f8',
          DEFAULT: '#ffb7d1',
          dark: '#ff85b3',
        }
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', 'sans-serif'],
      },
      borderRadius: {
        bubble: '18px',
      },
      animation: {
        'bounce-in': 'bounceIn 0.3s ease-out',
        'fade-up': 'fadeUp 0.2s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        bounceIn: {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '60%': { transform: 'scale(1.05)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        fadeUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        }
      }
    },
  },
  plugins: [],
}
