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
        // ── Official logo colors (sampled from public/assets/logo-vertical.png) ──
        // GREEN = wordmark → primary/anchor. CORAL = tagline + clock hands + rule → warm accent.
        // PURPLE + PINK = clock accents (energetic secondary family). See frontend/BRAND.md.
        green: {
          50:  '#eef7e9',
          100: '#dcefd0',
          200: '#bce0a3',
          300: '#97cf73',
          400: '#6fbb46',
          500: '#47a028',   // wordmark green — primary anchor
          600: '#3c8a20',
          700: '#316f1c',
          800: '#285a1a',
          900: '#224b18',
          DEFAULT: '#47a028',
          mid:    '#6fbb46',
          dark:   '#316f1c',
          bright: '#8bd15f',
          light:  '#eef7e9',
        },
        coral: {
          50:  '#fdecec',
          100: '#fbd5d3',
          200: '#f6aaa6',
          300: '#ef7a75',
          400: '#e64a44',
          500: '#dd2622',   // clock hands / tagline rule — warm accent
          600: '#c51d1a',
          700: '#a11816',
          800: '#841715',
          900: '#6d1614',
          DEFAULT: '#dd2622',
          dark:   '#c51d1a',
          light:  '#fdecec',
        },
        purple:  { DEFAULT: '#401a8e', mid: '#5e3aad', dark: '#4d22a8', light: '#ede8f7', xlight: '#e7e2f7' },
        pink:    { DEFAULT: '#ef2558', dark: '#d81a49', hot: '#ec1f7f', light: '#fde8ed', soft: '#ff6a8e', pale: '#ff8fa8' },
        amber:   { DEFAULT: '#d97706', bright: '#f5b300' },
        dark:    { DEFAULT: '#080516', 2: '#0f0a24', 3: '#1a1035', card: '#2a2342' },
        cream:   { DEFAULT: '#F5F4FA', 2: '#FAF9FD' },
        ink:     { DEFAULT: '#1A1130' },
        muted:   '#6E6885',
        subtle:  '#9A93AE',
        'nav-admisiones':  '#dd2622',
        'nav-circulares':  '#c84040',
        'nav-plataformas': '#47a028',
        'nav-galeria':     '#6b8c2e',
        'nav-contacto':    '#8b1a2e',
      },
      fontFamily: {
        head: ['Poppins', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      // Fluid type scale — clamp() so display type shrinks gracefully on mobile.
      fontSize: {
        'fluid-sm':   'clamp(0.8125rem, 0.78rem + 0.16vw, 0.875rem)',
        'fluid-base': 'clamp(0.9375rem, 0.9rem + 0.19vw, 1rem)',
        'fluid-lg':   'clamp(1.0625rem, 1rem + 0.31vw, 1.25rem)',
        'fluid-xl':   'clamp(1.25rem, 1.1rem + 0.75vw, 1.5rem)',
        'fluid-2xl':  'clamp(1.5rem, 1.3rem + 1vw, 2rem)',
        'fluid-3xl':  'clamp(1.875rem, 1.5rem + 1.9vw, 2.75rem)',
        'fluid-4xl':  'clamp(2.25rem, 1.7rem + 2.7vw, 3.5rem)',
        'fluid-5xl':  'clamp(2.75rem, 1.9rem + 4.2vw, 4.75rem)',
      },
      borderRadius: { xl2: '18px', xl3: '24px', xl4: '32px' },
      boxShadow: {
        card:   '0 1px 2px rgba(16,12,40,0.04), 0 8px 24px -12px rgba(64,26,142,0.12)',
        purple: '0 12px 28px -10px rgba(64,26,142,0.38)',
        pink:   '0 12px 28px -10px rgba(239,37,88,0.3)',
        green:  '0 12px 28px -10px rgba(71,160,40,0.32)',
        coral:  '0 12px 28px -10px rgba(221,38,34,0.3)',
      },
    },
  },
  plugins: [],
};
