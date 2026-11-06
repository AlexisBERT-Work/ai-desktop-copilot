import { describe, expect, it } from 'vitest';
import { renderVeilleHtml, renderVeilleMarkdown, veilleSubject } from './renderVeille';
import { EMPTY_REPORT, type VeilleReport } from './veilleSchema';

const NOW = new Date('2026-11-06T05:00:00Z');

const REPORT: VeilleReport = {
  headline: 'Un OCR local qui se vérifie lui-même',
  summary: 'Une piste forte aujourd’hui.',
  pistes: [
    {
      repo: 'OpenBMB/MiniCPM-OCR',
      title: 'OCR de meilleure qualité',
      verdict: 'a_faire',
      domain: 'Moteur local',
      integration: 'sidecar',
      gain: 'Lire les documents scannés sans erreurs.',
      how: 'Remplace Tesseract dans ocr-vision.',
      license: 'Apache-2.0 : code réutilisable.',
      effort: 'M',
      measure: 'Comparer sur dix scans.',
      risks: 'VRAM en plus de qwen3:14b.',
    },
  ],
  releases: [{ repo: 'ollama/ollama', version: 'v0.40.15', impact: 'Corrige Vulkan.' }],
  rejected: [{ repo: 'x/noise', reason: 'Clone de produit.' }],
};

const input = (report: VeilleReport) => ({ report, now: NOW, candidateCount: 54 });

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

  it('jour calme : ni carte, ni section vide', () => {
    const html = renderVeilleHtml(input(EMPTY_REPORT));
    expect(html).toContain('Aucun nouveau dépôt');
    expect(html).not.toContain('Nouvelles versions');
    expect(html).not.toContain('Écartés');
  });
});

describe('renderVeilleMarkdown', () => {
  it('garde tout le contenu, pour le mail texte et l’archive', () => {
    const md = renderVeilleMarkdown(input(REPORT));
    expect(md).toContain('## 🟢 À faire ensemble : OCR de meilleure qualité');
    expect(md).toContain('[OpenBMB/MiniCPM-OCR](https://github.com/OpenBMB/MiniCPM-OCR)');
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
