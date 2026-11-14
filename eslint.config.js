import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'public',
      'playwright-report',
      'test-results',
      'Claude outputs',
      '.claude',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  tseslint.configs.stylistic,
  {
    files: ['src/**/*.{ts,js}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**/*.{ts,js,mjs}', '*.config.*', 'e2e/**/*.{ts,js}'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  eslintConfigPrettier,
);
