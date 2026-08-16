import { describe, it, expect, vi, beforeEach } from 'vitest';

const call = vi.fn();
vi.mock('./ocrSidecar', () => ({
  OcrSidecarClient: { get: () => ({ call }) },
}));

const { extractArticleViaSidecar, articleExtractBreaker } = await import('./articleExtract');

beforeEach(() => {
  call.mockReset();
  // Le circuit est un singleton de module : sans reset, un test qui l'ouvre
  // ferait échouer les suivants sans qu'ils appellent quoi que ce soit.
  articleExtractBreaker.reset();
});

const GOOD = {
  title: 'Titre',
  text: 'Le contenu réel de l’article, débruité.',
  date: '2026-08-16',
  author: 'Quelqu’un',
  method: 'trafilatura',
};

describe('extractArticleViaSidecar', () => {
  it('renvoie le texte extrait et ses métadonnées', async () => {
    call.mockResolvedValue(GOOD);
    const res = await extractArticleViaSidecar('<html>…</html>', 'https://ex.test/a');

    expect(res).toEqual({
      title: 'Titre',
      text: 'Le contenu réel de l’article, débruité.',
      date: '2026-08-16',
      author: 'Quelqu’un',
      method: 'trafilatura',
    });
    expect(call).toHaveBeenCalledWith(
      'web.extract_article',
      { html: '<html>…</html>', url: 'https://ex.test/a' },
      15_000,
    );
  });

  it("omet l'url quand elle n'est pas fournie", async () => {
    call.mockResolvedValue(GOOD);
    await extractArticleViaSidecar('<html>…</html>');
    expect(call).toHaveBeenCalledWith('web.extract_article', { html: '<html>…</html>' }, 15_000);
  });

  it('renvoie null (jamais une exception) si le sidecar échoue', async () => {
    call.mockRejectedValue(new Error('trafilatura non installé'));
    await expect(extractArticleViaSidecar('<html>x</html>')).resolves.toBeNull();
  });

  it('renvoie null sur une réponse inexploitable', async () => {
    call.mockResolvedValue({ text: '   ' });
    await expect(extractArticleViaSidecar('<html>x</html>')).resolves.toBeNull();

    call.mockResolvedValue('pas un objet');
    await expect(extractArticleViaSidecar('<html>x</html>')).resolves.toBeNull();
  });

  it('normalise les métadonnées absentes en null', async () => {
    call.mockResolvedValue({ text: 'du contenu' });
    const res = await extractArticleViaSidecar('<html>x</html>');
    expect(res).toEqual({
      title: null,
      text: 'du contenu',
      date: null,
      author: null,
      method: 'trafilatura',
    });
  });

  it("n'appelle pas le sidecar sur un HTML vide ou démesuré", async () => {
    await expect(extractArticleViaSidecar('')).resolves.toBeNull();
    await expect(extractArticleViaSidecar('x'.repeat(2_000_001))).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('cesse de solliciter un sidecar sans trafilatura (le remède doit rester moins cher que le mal)', async () => {
    call.mockRejectedValue(new Error('Unknown method: web.extract_article'));

    await extractArticleViaSidecar('<html>1</html>');
    await extractArticleViaSidecar('<html>2</html>');
    expect(call).toHaveBeenCalledTimes(2);

    // Circuit ouvert : les articles suivants ne paient plus l'aller-retour.
    await extractArticleViaSidecar('<html>3</html>');
    await extractArticleViaSidecar('<html>4</html>');
    expect(call).toHaveBeenCalledTimes(2);
  });
});
