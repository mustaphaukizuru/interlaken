/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // `brand` remapped to the Interlaken purple scale so every existing
        // `brand-*` utility across the app rebrands automatically.
        brand: {
          50:  '#ede8f7',
          100: '#e7e2f7',
          200: '#d9cff0',
          300: '#b9a5e0',
          400: '#8f6fd0',
          500: '#5e3aad',
          600: '#401a8e',
          700: '#37167a',
          800: '#2c1163',
          900: '#1f0c47',
        },
        purple:  { DEFAULT: '#401a8e', mid: '#5e3aad', dark: '#4d22a8', light: '#ede8f7', xlight: '#e7e2f7' },
        pink:    { DEFAULT: '#ef2558', dark: '#d81a49', hot: '#ec1f7f', light: '#fde8ed', soft: '#ff6a8e', pale: '#ff8fa8' },
        teal:    { DEFAULT: '#1da2ab', bright: '#25c3cd', glow: '#5fd6df', light: '#e3f6f7' },
        green:   { DEFAULT: '#48a018', mid: '#3aa852', dark: '#2f9447', bright: '#48d06a' },
        amber:   { DEFAULT: '#d97706', bright: '#f5b300' },
        dark:    { DEFAULT: '#080516', 2: '#0f0a24', 3: '#1a1035', card: '#2a2342' },
        cream:   { DEFAULT: '#F5F4FA', 2: '#FAF9FD' },
        ink:     { DEFAULT: '#1A1130' },
        muted:   '#6E6885',
        subtle:  '#9A93AE',
        'nav-admisiones':  '#1da2ab',
        'nav-circulares':  '#c84040',
        'nav-plataformas': '#48a018',
        'nav-galeria':     '#6b8c2e',
        'nav-contacto':    '#8b1a2e',
      },
      fontFamily: {
        head: ['Poppins', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl2: '18px', xl3: '24px', xl4: '32px' },
      boxShadow: {
        card:   '0 1px 2px rgba(16,12,40,0.04), 0 8px 24px -12px rgba(64,26,142,0.12)',
        purple: '0 12px 28px -10px rgba(64,26,142,0.38)',
        pink:   '0 12px 28px -10px rgba(239,37,88,0.3)',
        teal:   '0 12px 28px -10px rgba(29,162,171,0.32)',
      },
    },
  },
  plugins: [],
};
