import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Environnement DOM pour TOUS les tests du desktop : avant, chaque fichier
// devait porter `// @vitest-environment jsdom`, et un test qui l'oubliait
// échouait sur un « document is not defined » incompréhensible.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }),
);
