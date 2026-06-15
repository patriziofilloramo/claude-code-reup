import eslintJs from '@eslint/js'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

import noRawUiStrings from './src/config/eslint-rules/no-raw-ui-strings.js'

const ccmPlugin = { rules: { 'no-raw-ui-strings': noRawUiStrings } }

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
    files: ['src/web/client.js'],
    languageOptions: {
      globals: {
        EventSource: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
      },
      sourceType: 'script',
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/tui/**/*.{ts,tsx}'],
    plugins: { ccm: ccmPlugin },
    rules: {
      // Warn when raw string literals appear in JSX text nodes.
      // Fix: use LABELS.xxx from src/config/labels.ts.
      'ccm/no-raw-ui-strings': 'warn',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js'],
  }
)
