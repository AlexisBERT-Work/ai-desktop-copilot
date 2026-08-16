import { describe, it, expect } from 'vitest';
import {
  ReadWebpageTool,
  htmlToText,
  extractBySelector,
  extractReadableText,
  extractArticleText,
  looksLikeProse,
  startsMidSentence,
  type FetchedPage,
  type ReadWebpageDeps,
} from './ReadWebpageTool';

// Échantillon réel du bug des dailys (2026-07-18) : titre du site + menu ×2 +
// sommaire d'un blog, aspirés comme « extrait » puis cités tels quels.
const NAV_JUNK =
  'Fable 5 vs. GPT-5.6 Sol on an NP-Hard Problem: Does /goal Help? - Charles AZAM CA Charles Azam ' +
  'Home Projects Blog Consulting Books fr fr Home Projects Blog Consulting Books On this page ' +
  'The problem How large is the search space? What I tested Results Deep dive into the goal command';

describe('htmlToText', () => {
  it('retire script et style', () => {
    const html = '<p>Bonjour</p><script>alert(1)</script><style>.a{}</style>';
    const out = htmlToText(html);
    expect(out).toContain('Bonjour');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('.a{}');
  });

  it('convertit les balises de bloc en sauts de ligne', () => {
    expect(htmlToText('<h1>Titre</h1><p>Para</p>')).toBe('Titre\n\nPara');
  });

  it('ignore les retours à la ligne du fichier source : une phrase repliée reste entière', () => {
    // Cause réelle du bug des dailys : la phrase coupée par le pliage du HTML
    // perdait son début (filtré comme non-prose) et le reste démarrait en
    // plein milieu (« ago writing C++ to solve it »).
    const html =
      '<p>I spent two evenings a couple of years\nago writing C++ to solve it, so I have a useful human baseline.</p>';
    expect(htmlToText(html)).toBe(
      'I spent two evenings a couple of years ago writing C++ to solve it, so I have a useful human baseline.',
    );
  });

  it('préserve les retours à la ligne DANS les <pre> (code)', () => {
    const html = '<p>Avant.</p><pre>ligne 1\n  ligne 2</pre><p>Après.</p>';
    const out = htmlToText(html);
    expect(out).toContain('ligne 1\n  ligne 2');
    expect(out).toContain('Avant.');
    expect(out).toContain('Après.');
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

  it("extrait par id (sélecteur naïf : s'arrête au premier </)", () => {
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

describe('looksLikeProse', () => {
  it('accepte des phrases rédigées (fr et en)', () => {
    expect(
      looksLikeProse(
        'Le gouvernement a annoncé mardi une réforme des retraites. Les syndicats appellent à la grève générale.',
      ),
    ).toBe(true);
    expect(
      looksLikeProse(
        'Rivian shares fell nearly 15% after the electric vehicle maker announced it would sell 75 million shares.',
      ),
    ).toBe(true);
  });

  it('rejette le menu de site + sommaire (échantillon réel du bug)', () => {
    expect(looksLikeProse(NAV_JUNK)).toBe(false);
  });

  it('rejette trop court ou sans ponctuation de phrase', () => {
    expect(looksLikeProse('court.')).toBe(false);
    expect(
      looksLikeProse(
        'des mots sans aucune ponctuation de phrase du tout mais assez longs pour dépasser la barre de longueur minimale pourtant',
      ),
    ).toBe(false);
  });
});

describe('startsMidSentence', () => {
  it('détecte un fragment pris en cours de phrase', () => {
    expect(
      startsMidSentence('optimization problem, with and without their native goal mode.'),
    ).toBe(true);
    expect(startsMidSentence('Rivian shares fell nearly 15% after the announcement.')).toBe(false);
    expect(startsMidSentence('« Une citation ouvrante. »')).toBe(false);
  });
});

describe('extractReadableText', () => {
  const PAGE = `<html><body>
    <header><a>Home</a> <a>Projects</a> <a>Blog</a> <a>Consulting</a> <a>Books</a></header>
    <nav><li>Home</li><li>Projects</li><li>Blog</li></nav>
    <article>
      <h1>Does /goal help?</h1>
      <p>La commande /goal transforme la manière dont le modèle explore l'espace de recherche. Nous avons mesuré ses effets sur un problème NP-difficile.</p>
      <p>Les résultats montrent une amélioration nette de la convergence sur les grandes instances, avec un coût mémoire constant.</p>
    </article>
    <footer>© 2026 — mentions légales</footer>
  </body></html>`;

  it("garde la prose de l'article, pas le menu ni le footer", () => {
    const out = extractReadableText(PAGE);
    expect(out).toContain("l'espace de recherche");
    expect(out).toContain('convergence');
    expect(out).not.toContain('Consulting');
    expect(out).not.toContain('mentions légales');
  });

  it('sans <article>, filtre quand même header/nav et les lignes non-prose', () => {
    const page = `<body><header><a>Home</a><a>Blog</a></header>
      <div><p>Une phrase complète qui explique le fond du sujet, avec des détails et un contexte suffisant.</p></div></body>`;
    const out = extractReadableText(page);
    expect(out).toContain('phrase complète');
    expect(out).not.toContain('Home');
  });

  it("renvoie '' quand la page n'a aucune prose (accueil, mur de cookies)", () => {
    const home =
      '<html><body><nav><a>Home</a><a>Blog</a></nav><ul><li>Post 1</li><li>Post 2</li></ul></body></html>';
    expect(extractReadableText(home)).toBe('');
  });
});

describe('ReadWebpageTool.execute (validation, sans réseau)', () => {
  const tool = new ReadWebpageTool();

  it('échoue sans url', async () => {
    const res = await tool.run({ url: '   ' });
    expect(res.success).toBe(false);
  });

  it('échoue sur une url invalide', async () => {
    const res = await tool.run({ url: 'pas une url' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/invalide/i);
  });

  it('rejette les protocoles non http(s)', async () => {
    const res = await tool.run({ url: 'ftp://example.com/file' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/http/i);
  });
});

describe('extractArticleText — cascade partagée read_webpage / pipeline presse', () => {
  const ARTICLE = `<html><body>
<nav><a href="/">Accueil</a></nav>
<article><p>Le groupe a publié un chiffre d'affaires de 4,2 milliards d'euros, en hausse de 12 % sur un an, dépassant le consensus des analystes.</p></article>
<footer><p>Mentions légales.</p></footer>
</body></html>`;

  it('préfère trafilatura quand le sidecar répond', async () => {
    const res = await extractArticleText(ARTICLE, 'https://ex.test/a', async () => ({
      text: 'texte trafilatura',
    }));
    expect(res).toEqual({ text: 'texte trafilatura', method: 'trafilatura' });
  });

  it("retombe sur l'heuristique quand le sidecar renvoie null", async () => {
    const res = await extractArticleText(ARTICLE, undefined, async () => null);
    expect(res.method).toBe('heuristique');
    expect(res.text).toContain('4,2 milliards');
    expect(res.text).not.toContain('Accueil');
  });

  it("retombe sur l'heuristique quand le sidecar LÈVE (et non sur rien)", async () => {
    // Régression : dans enrichArticleTexts, l'exception tombait dans le catch
    // global et l'article repartait avec son seul extrait RSS — on perdait
    // l'heuristique, pourtant toujours disponible.
    const res = await extractArticleText(ARTICLE, undefined, async () => {
      throw new Error('sidecar mort');
    });
    expect(res.method).toBe('heuristique');
    expect(res.text).toContain('4,2 milliards');
  });

  it('rend un texte vide sans lever quand la page n’a aucune prose', async () => {
    const res = await extractArticleText(
      '<html><body><nav>Accueil</nav></body></html>',
      undefined,
      async () => null,
    );
    expect(res.text).toBe('');
    expect(res.method).toBe('heuristique');
  });
});

describe("ReadWebpageTool.execute — cascade d'extraction (dépendances injectées)", () => {
  // Page réaliste : menu + bandeau cookies + article + « à lire aussi » + footer.
  const PAGE = `<html><head><title>Le titre</title></head><body>
<header><nav><a href="/">Accueil</a><a href="/eco">Économie</a></nav></header>
<div class="cookies">Nous utilisons des cookies pour améliorer votre expérience. Accepter. Refuser.</div>
<article>
<p>Le groupe a publié mercredi un chiffre d'affaires de 4,2 milliards d'euros, en hausse de 12 % sur un an, dépassant le consensus des analystes.</p>
<p>La marge opérationnelle s'établit à 18,4 %, contre 16,1 % un an plus tôt, grâce à la maîtrise des coûts logistiques.</p>
</article>
<aside><h3>À lire aussi</h3><ul><li>Un autre papier</li></ul></aside>
<footer><p>Mentions légales. Tous droits réservés.</p></footer>
</body></html>`;

  const page = (body: string, contentType = 'text/html; charset=utf-8'): FetchedPage => ({
    body,
    statusCode: 200,
    contentType,
  });

  const NOISE = ['cookies', 'Mentions', 'lire aussi', 'Accueil'];

  function build(deps: Partial<ReadWebpageDeps> & { body?: string; contentType?: string } = {}) {
    return new ReadWebpageTool({
      fetchPage: async () => page(deps.body ?? PAGE, deps.contentType),
      extractArticle: deps.extractArticle ?? (async () => null),
    });
  }

  it('sans sidecar, débruite via extractReadableText (chemin batch aligné)', async () => {
    const res = await build().run({ url: 'https://ex.test/a' });
    const d = res.data as { text: string; extraction: string };

    expect(d.extraction).toBe('heuristique');
    expect(d.text).toContain('4,2 milliards');
    for (const n of NOISE) expect(d.text, n).not.toContain(n);
  });

  it('utilise trafilatura quand le sidecar répond', async () => {
    const res = await build({
      extractArticle: async () => ({ text: 'Texte débruité par trafilatura.' }),
    }).run({ url: 'https://ex.test/a' });
    const d = res.data as { text: string; extraction: string };

    expect(d.extraction).toBe('trafilatura');
    expect(d.text).toBe('Texte débruité par trafilatura.');
  });

  it("retombe sur le texte brut quand la page n'a aucune prose (jamais moins qu'avant)", async () => {
    const wall = '<html><body><div>Cookies</div><nav>Accueil</nav></body></html>';
    const res = await build({ body: wall }).run({ url: 'https://ex.test/a' });
    const d = res.data as { text: string; extraction: string };

    // extractReadableText rend '' ici : sans repli, l'outil ne renverrait RIEN,
    // alors qu'il renvoyait ce texte avant l'alignement.
    expect(d.extraction).toBe('brut');
    expect(d.text.length).toBeGreaterThan(0);
  });

  it('avec un sélecteur, respecte la demande et ne consulte pas le sidecar', async () => {
    let called = false;
    const tool = new ReadWebpageTool({
      fetchPage: async () => page(PAGE),
      extractArticle: async () => {
        called = true;
        return { text: 'ne doit pas servir' };
      },
    });
    const res = await tool.run({ url: 'https://ex.test/a', selector: 'article' });
    const d = res.data as { text: string; extraction: string };

    expect(called).toBe(false);
    expect(d.extraction).toBe('selecteur');
    expect(d.text).toContain('4,2 milliards');
  });

  it('laisse le contenu non-HTML intact', async () => {
    const res = await build({ body: '{"a":1}', contentType: 'application/json' }).run({
      url: 'https://ex.test/a.json',
    });
    const d = res.data as { text: string; extraction: string };

    expect(d.extraction).toBe('brut');
    expect(d.text).toBe('{"a":1}');
  });

  it('un sidecar en panne ne casse rien : repli sur l’heuristique', async () => {
    const res = await build({
      extractArticle: async () => {
        throw new Error('sidecar mort');
      },
    }).run({ url: 'https://ex.test/a' });
    const d = res.data as { text: string; extraction: string };

    // extractArticleViaSidecar avale déjà ses erreurs ; ce test verrouille le
    // fait que l'outil ne dépend PAS de cette politesse pour rester debout.
    expect(res.success).toBe(true);
    expect(d.extraction).toBe('heuristique');
    expect(d.text).toContain('4,2 milliards');
    for (const n of NOISE) expect(d.text, n).not.toContain(n);
  });
});
