import { describe, expect, it } from 'vitest';
import type { RepoCandidate, WatchedRelease } from '../veille/collectRepos';
import type { VeillePiste, VeilleReport } from '../veille/veilleSchema';
import { veilleToCards } from './veilleCards';

const NOW = new Date('2026-11-07T04:50:00Z');

function candidate(repo: string, license: string | null): RepoCandidate {
  return {
    id: '',
    repo,
    domain: 'Moteur local',
    via: 'recherche',
    description: '',
    language: null,
    topics: [],
    stars: 100,
    forks: 10,
    ageDays: 10,
    starsPerDay: 10,
    pushedAt: '2026-11-05T00:00:00Z',
    license,
    licenseKind: 'libre',
    suspect: false,
    contributors: null,
    readmeFile: null,
    excerpt: '',
  };
}

const OCR: VeillePiste = {
  repo: 'OpenBMB/MiniCPM-OCR',
  title: 'OCR de meilleure qualité',
  verdict: 'a_garder',
  domain: 'Moteur local',
  integration: 'sidecar',
  gain: 'Lire les documents scannés sans erreurs.',
  why: 'Prometteur, mais trois semaines d’âge.',
  how: 'Remplace Tesseract dans ocr-vision.',
  license: 'Apache-2.0 : code réutilisable.',
  effort: 'M',
  measure: 'Comparer sur dix scans.',
  risks: 'VRAM en plus de qwen3:14b.',
};

const MCP: VeillePiste = {
  ...OCR,
  repo: 'acme/mail-mcp',
  title: 'Trier ses mails par MCP',
  verdict: 'a_faire',
  integration: 'mcp',
  effort: 'S',
};

const RELEASE: WatchedRelease = {
  repo: 'ollama/ollama',
  version: 'v0.40.15',
  url: 'https://github.com/ollama/ollama/releases/tag/v0.40.15',
  publishedAt: null,
  notes: 'Corrige le backend Vulkan.',
};

const REPORT: VeilleReport = {
  headline: 'Un OCR local',
  summary: 'Deux pistes.',
  pistes: [OCR, MCP, { ...OCR, repo: 'ghost/invented', title: 'Inventé' }],
  releases: [{ repo: 'ollama/ollama', version: 'v0.40.15', impact: 'Corrige Vulkan.' }],
  rejected: [],
};

const cards = veilleToCards({
  report: REPORT,
  candidates: [candidate('OpenBMB/MiniCPM-OCR', 'Apache-2.0'), candidate('acme/mail-mcp', null)],
  releases: [RELEASE],
  now: NOW,
});

describe('veilleToCards', () => {
  it('mêmes pistes et même ordre que le mail : dépôt inventé écarté, « à faire » en tête', () => {
    expect(cards.map(c => [c.kind, c.title])).toEqual([
      ['github', 'Trier ses mails par MCP'],
      ['github', 'OCR de meilleure qualité'],
      ['version', 'ollama/ollama v0.40.15'],
    ]);
    expect(cards.map(c => c.rank)).toEqual([0, 1, 2]);
    expect(cards.every(c => c.day === '2026-11-07')).toBe(true);
  });

  it('piste : gain en résumé, verdict et raison, détail complet, renvoi à l’archive', () => {
    const ocr = cards[1]!;
    expect(ocr).toMatchObject({
      summary: 'Lire les documents scannés sans erreurs.',
      why: 'Prometteur, mais trois semaines d’âge.',
      verdict: 'a_garder',
      url: 'https://github.com/OpenBMB/MiniCPM-OCR',
      source: 'OpenBMB/MiniCPM-OCR · Apache-2.0',
    });
    expect(ocr.details).toContain('Sidecar Python · quelques jours · Moteur local');
    expect(ocr.details).toContain('**Où ça se branche** : Remplace Tesseract dans ocr-vision.');
    expect(ocr.details).toContain('**Risques** : VRAM en plus de qwen3:14b.');
    expect(ocr.details).toContain('« veille du 7/11, piste 2 »');
    expect(cards[0]!.source).toBe('acme/mail-mcp · licence inconnue');
  });

  it('version : lien vers la release, notes au détail', () => {
    expect(cards[2]).toMatchObject({
      summary: 'Corrige Vulkan.',
      url: 'https://github.com/ollama/ollama/releases/tag/v0.40.15',
      details: 'Corrige le backend Vulkan.',
      verdict: null,
    });
  });

  it('jour sans rien : aucune carte', () => {
    const empty = { ...REPORT, pistes: [], releases: [] };
    expect(veilleToCards({ report: empty, candidates: [], releases: [], now: NOW })).toEqual([]);
  });
});
