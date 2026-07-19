import { describe, it, expect } from 'vitest';
import {
  ReadWebpageTool,
  htmlToText,
  extractBySelector,
  extractReadableText,
  looksLikeProse,
  startsMidSentence,
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
