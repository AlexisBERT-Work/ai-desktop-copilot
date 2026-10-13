// Chargé avant chaque fichier de test (vitest.config.ts › setupFiles) :
// matchers DOM (`toBeInTheDocument`…) et nettoyage du rendu entre deux tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Stockage de secours pour les stores persistés (zustand `persist`).
// Node ≥ 24 définit un `localStorage` global qui vaut `undefined` sans
// `--localstorage-file`, et vitest n'installe celui de jsdom que si la clé est
// absente de globalThis (`getWindowKeys`, et sa liste ne cite pas les Storage).
// Résultat : `localStorage.setItem` plantait sur Node 26 en local, jamais en CI
// (Node 22, où le global n'existe pas et jsdom gagne). On ne pose donc ce
// substitut que lorsqu'il n'y a rien.
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => void entries.delete(key),
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
  };
}

const globalStorages = globalThis as unknown as Record<string, Storage | undefined>;
for (const key of ['localStorage', 'sessionStorage'] as const) {
  if (globalStorages[key] === undefined) {
    Object.defineProperty(globalThis, key, {
      value: memoryStorage(),
      configurable: true,
      writable: true,
    });
  }
}

afterEach(() => cleanup());
