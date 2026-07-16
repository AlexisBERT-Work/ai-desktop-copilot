import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

// Flat config (ESLint 9) unique pour tout le monorepo.
// Chaque package lance `eslint src` ; ESLint remonte jusqu'à cette config.
export default tseslint.config(
  {
    ignores: [
      '**/dist',
      '**/build-dist',
      'apps/desktop/src-tauri/target',
      'packages/ocr-vision',
      '**/*.config.{js,mjs,ts}',
      '**/esbuild.config.mjs',
    ],
  },
  // Tronc commun TypeScript (tous les packages).
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
    },
    rules: {
      // Allow intentionally-unused args prefixed with _.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // Front-end React (Vite + React 19).
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Tout invoke() passe par la couche API (shared/api/) — pas d'appel
      // Tauri direct depuis les composants/stores.
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@tauri-apps/api/core',
          message: 'Utilise la couche API (src/shared/api/) au lieu d\'invoke() direct.',
        }],
      }],
    },
  },
  // La couche API est le seul endroit autorisé à parler à Tauri core.
  {
    files: ['apps/desktop/src/shared/api/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // Packages Node (sidecar agent + types partagés).
  {
    files: ['packages/agent-runtime/src/**/*.ts', 'packages/shared-types/src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // Doubles de test : `any` toléré uniquement dans les fichiers de test.
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
