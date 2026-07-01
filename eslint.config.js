import eslintJs from '@eslint/js'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

import noRawUiStrings from './src/config/eslint-rules/no-raw-ui-strings.js'

const reupPlugin = { rules: { 'no-raw-ui-strings': noRawUiStrings } }

export default tseslint.config(
  eslintJs.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    files: ['extension/src/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'extension/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/web/client.js'],
    languageOptions: {
      globals: {
        EventSource: 'readonly',
        Notification: 'readonly',
        cancelAnimationFrame: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        confirm: 'readonly',
        console: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        history: 'readonly',
        location: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        requestAnimationFrame: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
      },
      sourceType: 'script',
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/tui/**/*.{ts,tsx}'],
    plugins: { reup: reupPlugin },
    rules: {
      // Warn when raw string literals appear in JSX text nodes.
      // Fix: use LABELS.xxx from src/config/labels.ts.
      'reup/no-raw-ui-strings': 'warn',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'extension/dist/**',
      'src/web/client/**',
      '*.config.js',
    ],
  }
)
