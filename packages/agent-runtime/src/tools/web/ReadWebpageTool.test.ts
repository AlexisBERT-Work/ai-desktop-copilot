import { describe, it, expect } from 'vitest';
import { ReadWebpageTool, htmlToText, extractBySelector } from './ReadWebpageTool';

describe('htmlToText', () => {
  it('retire script et style', () => {
    const html = '<p>Bonjour</p><script>alert(1)</script><style>.a{}</style>';
    const out = htmlToText(html);
    expect(out).toContain('Bonjour');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('.a{}');
  });

  it('convertit les balises de bloc en sauts de ligne', () => {
    expect(htmlToText('<h1>Titre</h1><p>Para</p>')).toBe('Titre\nPara');
  });

  it('décode les entités HTML', () => {
    expect(htmlToText('a &amp; b &lt;c&gt; &#39;d&#39; &#65;')).toBe("a & b <c> 'd' A");
  });

  it('réduit les espaces multiples', () => {
    expect(htmlToText('<p>trop    d   espaces</p>')).toBe('trop d espaces');
  });
});

describe('extractBySelector', () => {
  const html = '<div id="main"><h1>Titre</h1></div><span class="note">Info</span>';

  it('extrait par balise', () => {
    expect(extractBySelector(html, 'h1')).toBe('Titre');
  });

  it('extrait par id (sélecteur naïf : s\'arrête au premier </)', () => {
    // Limitation assumée : la capture est non-greedy et stoppe au 1er "</",
    // donc on récupère le début du contenu, pas le bloc fermé complet.
    expect(extractBySelector(html, '#main')).toBe('<h1>Titre');
  });

  it('extrait par classe', () => {
    expect(extractBySelector(html, '.note')).toBe('Info');
  });

  it('renvoie null si aucune correspondance', () => {
    expect(extractBySelector(html, '#absent')).toBeNull();
  });
});

describe('ReadWebpageTool.execute (validation, sans réseau)', () => {
  const tool = new ReadWebpageTool();

  it('échoue sans url', async () => {
    const res = await tool.execute({ url: '   ' });
    expect(res.success).toBe(false);
  });

  it('échoue sur une url invalide', async () => {
    const res = await tool.execute({ url: 'pas une url' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/invalide/i);
  });

  it('rejette les protocoles non http(s)', async () => {
    const res = await tool.execute({ url: 'ftp://example.com/file' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/http/i);
  });
});
