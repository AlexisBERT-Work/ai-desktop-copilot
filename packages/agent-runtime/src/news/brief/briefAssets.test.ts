import { describe, expect, it, vi } from 'vitest';
import {
  buildBriefAssets,
  diagramUrl,
  layoutDiagram,
  pageImage,
  pngSize,
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

/** En-tête PNG minimal (signature + IHDR) aux dimensions données. */
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

describe('pngSize', () => {
  it('lit largeur et hauteur, refuse ce qui n’est pas un PNG', () => {
    expect(pngSize(pngHeader(1200, 843))).toEqual({ width: 1200, height: 843 });
    expect(pngSize(Buffer.from('<html>'))).toBeNull();
  });
});

describe('buildBriefAssets — largeur du schéma', () => {
  it('schéma vertical mais plus large que haut : affiché pleine largeur', async () => {
    const d = deps({
      fetchBinary: vi
        .fn<AssetDeps['fetchBinary']>()
        .mockResolvedValue({ body: pngHeader(1200, 843), contentType: 'image/png' }),
    });
    const brief = {
      ...BRIEF,
      leads: [{ ...BRIEF.leads[0]!, diagram: { mermaid: 'flowchart TD\n A --> B', caption: 'c' } }],
    };
    const res = await buildBriefAssets(brief, [], d);
    expect(res.visuals[0]?.diagram).toBe('lead1-diagram');
    expect(res.visuals[0]?.diagramVertical).toBeUndefined();
  });

  it('schéma plus haut que large : affiché étroit', async () => {
    const d = deps({
      fetchBinary: vi
        .fn<AssetDeps['fetchBinary']>()
        .mockResolvedValue({ body: pngHeader(1200, 2291), contentType: 'image/png' }),
    });
    const res = await buildBriefAssets(BRIEF, [], d);
    expect(res.visuals[0]?.diagramVertical).toBe(true);
  });
});
