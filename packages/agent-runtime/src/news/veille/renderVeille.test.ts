import { describe, expect, it } from 'vitest';
import {
  parsePastPistes,
  renderVeilleHtml,
  renderVeilleMarkdown,
  renderVeilleText,
  veilleSubject,
} from './renderVeille';
import { EMPTY_REPORT, type VeillePiste, type VeilleReport } from './veilleSchema';

const NOW = new Date('2026-11-06T05:00:00Z');

const OCR: VeillePiste = {
  repo: 'OpenBMB/MiniCPM-OCR',
  title: 'OCR de meilleure qualité',
  verdict: 'a_faire',
  domain: 'Moteur local',
  integration: 'sidecar',
  gain: 'Lire les documents scannés sans erreurs.',
  why: 'Apache-2.0, et la brique OCR existe déjà.',
  how: 'Remplace Tesseract dans ocr-vision.',
  license: 'Apache-2.0 : code réutilisable.',
  effort: 'M',
  measure: 'Comparer sur dix scans.',
  risks: 'VRAM en plus de qwen3:14b.',
};

const REPORT: VeilleReport = {
  headline: 'Un OCR local qui se vérifie lui-même',
  summary: 'Une piste forte aujourd’hui.',
  pistes: [OCR],
  releases: [{ repo: 'ollama/ollama', version: 'v0.40.15', impact: 'Corrige Vulkan.' }],
  rejected: [{ repo: 'x/noise', reason: 'Clone de produit.' }],
};

const LICENSES = new Map<string, string | null>([
  ['OpenBMB/MiniCPM-OCR', 'Apache-2.0'],
  ['young/repo', null],
]);

const input = (report: VeilleReport) => ({
  report,
  now: NOW,
  candidateCount: 54,
  licenses: LICENSES,
});

const YOUNG: VeillePiste = {
  ...OCR,
  repo: 'young/repo',
  title: 'Une autre piste',
  verdict: 'a_garder',
  effort: 'S',
  why: 'Quatre jours, un seul contributeur.',
};

describe('renderVeilleHtml', () => {
  it('rend les pistes, les versions et les écartés avec leurs liens', () => {
    const html = renderVeilleHtml(input(REPORT));
    expect(html).toContain('OCR de meilleure qualité');
    expect(html).toContain('🟢 À faire ensemble');
    expect(html).toContain('href="https://github.com/OpenBMB/MiniCPM-OCR"');
    expect(html).toContain('href="https://github.com/ollama/ollama"');
    expect(html).toContain('href="https://github.com/x/noise"');
    expect(html).toContain('54 dépôts');
  });

  it('court : de quoi décider, le détail reste dans l’archive', () => {
    const html = renderVeilleHtml(input(REPORT));
    expect(html).toContain('1. 🟢 À faire ensemble · quelques jours · Apache-2.0');
    expect(html).toContain('Lire les documents scannés sans erreurs.');
    expect(html).toContain('Pourquoi 🟢 : Apache-2.0, et la brique OCR existe déjà.');
    expect(html).not.toContain('Remplace Tesseract');
    expect(html).not.toContain('Comparer sur dix scans');
    expect(html).not.toContain('VRAM en plus');
  });

  it('numérote les pistes et dit comment en demander une', () => {
    const html = renderVeilleHtml(input({ ...REPORT, pistes: [OCR, YOUNG] }));
    expect(html).toContain('2. 🟡 À garder · une soirée · licence inconnue');
    expect(html).toContain('Pourquoi 🟡 : Quatre jours, un seul contributeur.');
    expect(html).toContain('« veille du 6/11, piste 1 »');
  });

  it('un écarté tient sur une ligne', () => {
    const long = `${'Une raison détaillée. '.repeat(3)}${'x'.repeat(200)}`;
    const html = renderVeilleHtml(
      input({ ...REPORT, rejected: [{ repo: 'x/noise', reason: long }] }),
    );
    expect(html).toContain('Une raison détaillée. Une raison détaillée.');
    expect(html).not.toContain('xxxxx');
  });

  it('un texte piégé reste du texte : ni balise, ni lien', () => {
    const trapped: VeilleReport = {
      ...REPORT,
      summary: '<a href="https://evil.example">clique</a>',
      pistes: REPORT.pistes.map(p => ({ ...p, gain: '<script>alert(1)</script>' })),
    };
    const html = renderVeilleHtml(input(trapped));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="https://evil.example"');
    expect(html).toContain('&lt;script&gt;');
  });

  it('jour calme : ni carte, ni section vide, ni piste à demander', () => {
    const html = renderVeilleHtml(input(EMPTY_REPORT));
    expect(html).toContain('Aucun nouveau dépôt');
    expect(html).not.toContain('Nouvelles versions');
    expect(html).not.toContain('Écartés');
    expect(html).not.toContain('veille du');
  });
});

describe('renderVeilleText', () => {
  it('même version courte que le HTML, liens en clair', () => {
    const text = renderVeilleText(input(REPORT));
    expect(text).toContain('1. 🟢 À faire ensemble · quelques jours · Apache-2.0');
    expect(text).toContain('https://github.com/OpenBMB/MiniCPM-OCR · Sidecar Python');
    expect(text).toContain('Pourquoi 🟢 : Apache-2.0');
    expect(text).toContain('« veille du 6/11, piste 1 »');
    expect(text).not.toContain('Remplace Tesseract');
  });
});

describe('renderVeilleMarkdown', () => {
  it('l’archive garde tout le contenu, pistes numérotées', () => {
    const md = renderVeilleMarkdown(input(REPORT));
    expect(md).toContain('## Piste 1 · 🟢 À faire ensemble : OCR de meilleure qualité');
    expect(md).toContain('[OpenBMB/MiniCPM-OCR](https://github.com/OpenBMB/MiniCPM-OCR)');
    expect(md).toContain('**Pourquoi ce verdict** : Apache-2.0');
    expect(md).toContain('**Où ça se branche** : Remplace Tesseract dans ocr-vision.');
    expect(md).toContain('**Comment le mesurer** : Comparer sur dix scans.');
    expect(md).toContain('## Nouvelles versions');
    expect(md).toContain('## Écartés');
  });

  it('jour calme : deux lignes utiles, sans rubrique vide', () => {
    const md = renderVeilleMarkdown(input(EMPTY_REPORT));
    expect(md).toContain('Rien de neuf');
    expect(md).not.toContain('##');
  });
});

describe('parsePastPistes', () => {
  it('relit ce que l’archive a écrit', () => {
    const md = renderVeilleMarkdown(input({ ...REPORT, pistes: [OCR, YOUNG] }));
    expect(parsePastPistes(md)).toEqual([
      { verdict: 'a_faire', title: 'OCR de meilleure qualité', repo: 'OpenBMB/MiniCPM-OCR' },
      { verdict: 'a_garder', title: 'Une autre piste', repo: 'young/repo' },
    ]);
  });

  it('relit aussi le premier format, sans numéro (rapports des 6 et 7/11)', () => {
    const old = [
      '## 🟢 À faire ensemble : Masquer les données personnelles dans les sorties d’outils',
      '',
      '[strugglesky/scrubshot](https://github.com/strugglesky/scrubshot) · Idée à reprendre · Moteur local · une soirée',
      '',
      '## 🟡 À garder : Compte rendu de réunion : locuteurs et citations',
      '',
      '[tancheng33/tingo](https://github.com/tancheng33/tingo) · Outil · Moteur local · quelques jours',
      '',
      '## Écartés',
      '',
      '- [x/noise](https://github.com/x/noise) : bruit',
    ].join('\r\n');
    expect(parsePastPistes(old)).toEqual([
      {
        verdict: 'a_faire',
        title: 'Masquer les données personnelles dans les sorties d’outils',
        repo: 'strugglesky/scrubshot',
      },
      {
        verdict: 'a_garder',
        title: 'Compte rendu de réunion : locuteurs et citations',
        repo: 'tancheng33/tingo',
      },
    ]);
  });

  it('ignore une piste sans ligne de dépôt, et un rapport vide', () => {
    expect(parsePastPistes('## 🟢 À faire ensemble : Orpheline\n\ntexte libre')).toEqual([]);
    expect(parsePastPistes(renderVeilleMarkdown(input(EMPTY_REPORT)))).toEqual([]);
  });
});

describe('veilleSubject', () => {
  it('porte le fait du jour', () => {
    expect(veilleSubject(REPORT)).toBe('Veille CatDesk : Un OCR local qui se vérifie lui-même');
  });

  it('coupe un titre démesuré', () => {
    const subject = veilleSubject({ ...REPORT, headline: 'x'.repeat(300) });
    expect(subject.length).toBeLessThanOrEqual(110);
    expect(subject.endsWith('…')).toBe(true);
  });
});
