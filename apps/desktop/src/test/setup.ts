// Chargé avant chaque fichier de test (vitest.config.ts › setupFiles) :
// matchers DOM (`toBeInTheDocument`…) et nettoyage du rendu entre deux tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
