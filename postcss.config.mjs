/**
 * PostCSS pipeline for Tailwind v4.
 * v4 ships a dedicated PostCSS plugin package; legacy `tailwindcss: {}`
 * entry is no longer correct.
 */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};
