/**
 * Storybook Tailwind config — same preset as the web app so what you see in
 * Storybook is exactly what ships in the product. We scan the design system
 * sources directly (no need for the apps/web tree to be present).
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  presets: [require('@blueprint/ui/tailwind-preset')],
  content: [
    './stories/**/*.{ts,tsx,mdx}',
    './.storybook/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};
