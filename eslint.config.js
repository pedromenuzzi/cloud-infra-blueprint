// Lint for mistakes TypeScript can't see — above all the rules of hooks (a
// hook after an early return once crashed the whole app).
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'test-results/', 'playwright-report/', '.claude/', '.tf-templates/'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-debugger': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // command-line scripts report to the terminal
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
);
