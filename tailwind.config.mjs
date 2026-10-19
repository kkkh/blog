import { animation as animationTokens, borderRadius, colors, shadows } from './src/constants/design-tokens.ts';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    screens: {
      xs: { max: '480px' },
      md: { max: '768px' },
      lg: { max: '1440px' },
      tablet: { max: '992px' },
      desktop: { min: '1480px' },
    },
    extend: {
      colors: {
        // Design token colors
        ...colors,
        // Existing custom colors (for backward compatibility)
        'gradient-start': 'var(--gradient-bg-start)',
        'gradient-end': 'var(--gradient-bg-end)',
        'gradient-shoka-button-start': 'var(--gradient-shoka-button-start)',
        'gradient-shoka-button-end': 'var(--gradient-shoka-button-end)',
        blue: {
          DEFAULT: 'hsl(var(--shoka-blue))',
        },
        gray: {
          400: 'hsl(var(--grey-4))',
        },
        logo: '#b25237',
        mandy: {
          50: '#f9ebe6',
          100: '#f4dbd2',
          200: '#eac2b3',
          300: '#dc9f89',
          400: '#cd7251',
          500: '#a34d2e',
          600: '#89432a',
          700: '#6f3925',
          800: '#562e1f',
          900: '#46271b',
          950: '#2b1912',
        },
        // shoka migrate
        brand: {
          a3: 'var(--color-selection-bg)',
          DEFAULT: 'var(--color-brand)',
        },
      },
      borderRadius: {
        ...borderRadius,
        // Existing custom radius (for backward compatibility)
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        ...shadows,
      },
      keyframes: {
        'vertical-shake': {
          '0%': { transform: 'scale(1)' },
          '10%': { transform: 'scale(.9) rotate(3deg)' },
          '20%': { transform: 'scale(.9) rotate(3deg)' },
          '30%': { transform: 'scale(1.1) rotate(-3deg)' },
          '40%': { transform: 'scale(1.1) rotate(3deg)' },
          '50%': { transform: 'scale(1.1) rotate(-3deg)' },
          '60%': { transform: 'scale(1.1) rotate(3deg)' },
          '70%': { transform: 'scale(1.1) rotate(-3deg)' },
          '80%': { transform: 'scale(1.1) rotate(3deg)' },
          '90%': { transform: 'scale(1.1) rotate(-3deg)' },
          '100%': { transform: 'scale(1)' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'slide-in-from-right': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-out-to-left': {
          from: { opacity: '1', transform: 'translateX(0)' },
          to: { opacity: '0', transform: 'translateX(-12px)' },
        },
      },
      animation: {
        shake: 'shake 2s ease',
        'vertical-shake': 'vertical-shake 1s',
        'slide-down': 'slide-down 0.2s ease-out',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'slide-in-from-right': 'slide-in-from-right 0.2s ease-in-out',
        'slide-out-to-left': 'slide-out-to-left 0.2s ease-in-out',
      },
      transitionDuration: {
        fast: `${animationTokens.duration.fast}ms`,
        normal: `${animationTokens.duration.normal}ms`,
        slow: `${animationTokens.duration.slow}ms`,
        slower: `${animationTokens.duration.slower}ms`,
      },
      transitionTimingFunction: {
        ...animationTokens.easing,
      },
      backgroundImage: {
        gradient: 'var(--gradient-bg)',
        'gradient-brand': 'var(--gradient-brand)',
        'gradient-header': 'var(--gradient-header)',
        'gradient-shoka-button': 'var(--gradient-shoka-button)',
        'shoka-card-mask': 'linear-gradient(135deg,#434343 0,#000 100%)',
      },
      fontSize: {
        '4.5xl': '2.5rem',
        '5.5xl': '3.5rem',
      },
      fontFamily: {
        sans: ['寒蝉全圆体', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        'chill-round': ['寒蝉全圆体', 'sans-serif'],
      },
      clipPath: {
        'post-img-left': 'polygon(0 0,92% 0%,100% 100%,0% 100%)',
        'post-img-right': 'polygon(0 0%,100% 0%,100% 100%,8% 100%)',
      },
      spacing: {
        7.5: '1.875rem',
        8.5: '2.125rem',
        14.5: '3.625rem',
        15: '3.75rem',
        16.5: '4.125rem',
        17: '4.25rem',
        19: '4.75rem',
      },
      maxWidth: {
        '8xl': '87.5rem',
      },
      borderWidth: {
        16: '16px',
      },
    },
  },
  plugins: [require('@tailwindcss/container-queries'), require('tailwindcss-animate'), require('@tailwindcss/typography')],
};
