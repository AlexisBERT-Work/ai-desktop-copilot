import { describe, expect, it, vi } from 'vitest';
import {
  buildBriefAssets,
  diagramUrl,
  layoutDiagram,
  pageImage,
  type AssetDeps,
} from './briefAssets';
import type { Candidate } from './collectCandidates';
import { BRIEF_FIXTURE as BRIEF } from './briefFixture';

const PNG = { body: Buffer.from('png-bytes'), contentType: 'image/png' };

function deps(over: Partial<AssetDeps> = {}): AssetDeps {
  return {
    fetchBinary: vi.fn<AssetDeps['fetchBinary']>().mockResolvedValue(PNG),
    fetchText: vi.fn<AssetDeps['fetchText']>().mockResolvedValue(''),
    ...over,
  };
}

const candidate = (over: Partial<Candidate>): Candidate => ({
  id: 'a1',
  title: 't',
  url: 'https://the-decoder.com/a',
  source: 'The Decoder',
  lang: 'en',
  publishedAt: null,
  excerpt: '',
  image: null,
  ...over,
});

describe('pageImage', () => {
  it('lit og:image quel que soit l’ordre des attributs, sinon twitter:image', () => {
    expect(pageImage('<meta content="https://ex.com/o.jpg" property="og:image">')).toBe(
      'https://ex.com/o.jpg',
    );
    expect(
      pageImage('<meta name="twitter:image" content="https://ex.com/t.png?a=1&amp;b=2">'),
    ).toBe('https://ex.com/t.png?a=1&b=2');
    expect(pageImage('<meta property="og:image" content="/relatif.jpg">')).toBeNull();
  });
});

describe('diagramUrl', () => {
  it('encode le code Mermaid en base64url pour mermaid.ink', () => {
    const url = diagramUrl('flowchart LR\n  A[Élu] --> B');
    expect(url.startsWith('https://mermaid.ink/img/')).toBe(true);
    const code = url.split('/img/')[1]!.split('?')[0]!;
    expect(Buffer.from(code, 'base64url').toString('utf-8')).toBe('flowchart LR\n  A[Élu] --> B');
  });
});

describe('buildBriefAssets', () => {
  it('garde l’image proposée seulement si un flux l’annonçait', async () => {
    const d = deps();
    const announced = [candidate({ image: 'https://cdn.ex.com/a.jpg' })];
    const res = await buildBriefAssets(BRIEF, announced, d);
    expect(d.fetchBinary).toHaveBeenCalledWith('https://cdn.ex.com/a.jpg', expect.anything());
    expect(res.visuals[0]).toEqual({ image: 'lead1-image', diagram: 'lead1-diagram' });
    expect(res.images.map(i => i.id)).toEqual(['lead1-image', 'lead1-diagram']);
  });

  it('URL inventée : se rabat sur l’og:image de la source principale', async () => {
    const d = deps({
      fetchText: vi
        .fn<AssetDeps['fetchText']>()
        .mockResolvedValue('<meta property="og:image" content="https://the-decoder.com/og.jpg">'),
    });
    await buildBriefAssets(BRIEF, [candidate({ image: null })], d);
    expect(d.fetchBinary).not.toHaveBeenCalledWith('https://cdn.ex.com/a.jpg', expect.anything());
    expect(d.fetchBinary).toHaveBeenCalledWith('https://the-decoder.com/og.jpg', expect.anything());
  });

  it('un visuel qui n’est pas une image, ou en échec, devient « pas de visuel »', async () => {
    const d = deps({
      fetchBinary: vi
        .fn<AssetDeps['fetchBinary']>()
        .mockResolvedValueOnce({ body: Buffer.from('<html>'), contentType: 'text/html' })
        .mockRejectedValueOnce(new Error('HTTP 500')),
    });
    const res = await buildBriefAssets(
      BRIEF,
      [candidate({ image: 'https://cdn.ex.com/a.jpg' })],
      d,
    );
    expect(res.visuals[0]).toEqual({ image: null, diagram: null });
    expect(res.images).toEqual([]);
  });
});

describe('layoutDiagram', () => {
  it('passe une longue chaîne horizontale à la verticale', () => {
    const code = 'flowchart LR\n A["a"] --> B["b"]\n B --> C\n C --> D\n D --> E';
    expect(layoutDiagram(code)).toEqual({
      code: 'flowchart TD\n A["a"] --> B["b"]\n B --> C\n C --> D\n D --> E',
      vertical: true,
    });
  });

  it('garde une courte chaîne horizontale, signale un schéma déjà vertical', () => {
    expect(layoutDiagram('flowchart LR\n A --> B\n B --> C')).toEqual({
      code: 'flowchart LR\n A --> B\n B --> C',
      vertical: false,
    });
    expect(layoutDiagram('graph TD\n A --> B').vertical).toBe(true);
    expect(layoutDiagram('timeline\n 2026 : AI Act').vertical).toBe(false);
  });
});
