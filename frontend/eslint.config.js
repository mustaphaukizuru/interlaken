import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores([
    'dist',
    'node_modules',
    'coverage',
    'playwright-report',
    'test-results',
    'vite.config.ts',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      jsxA11y.flatConfigs.recommended,
      reactRefresh.configs.vite,
      // v7 flat recommended preset: classic pair (rules-of-hooks error,
      // exhaustive-deps warn) plus the React Compiler rule set
      // (set-state-in-effect, purity, refs, …) at their preset severities.
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2020 },
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      // `role` is a domain prop on our own components (PortalLayout role="parent"),
      // not the DOM ARIA attribute — only lint role on real DOM elements.
      'jsx-a11y/aria-role': ['error', { ignoreNonDOM: true }],
    },
  },
])
