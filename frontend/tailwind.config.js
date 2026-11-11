/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Azul corporativo GUATECH (estándar) y gris de encabezados de listado (§6).
        primary: { DEFAULT: '#4997D0', 50: '#eef6fc', 100: '#d6e8f7', 600: '#4997D0', 700: '#3480b8' },
        secondary: { DEFAULT: '#A6A6A6', hover: '#9a9a9a' },
      },
      fontFamily: { sans: ['Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
