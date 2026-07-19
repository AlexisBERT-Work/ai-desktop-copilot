import { describe, it, expect } from 'vitest';
import { PRESS_SOURCE_CATALOG } from '@catdesk/shared-types';
import {
  NEWS_SOURCES,
  parseFeed,
  dedupeItems,
  filterByTopics,
  filterByRegex,
  safeRegex,
  filterByAge,
  rankItems,
  toExcerpt,
  cutAtSentence,
  feedLabelFromUrl,
  type NewsItem,
} from './FetchTechNewsTool';

describe('PRESS_SOURCE_CATALOG (shared-types) ↔ NEWS_SOURCES (agent)', () => {
  it('les deux listes ont exactement les mêmes ids et labels', () => {
    const agent = Object.values(NEWS_SOURCES)
      .map(s => `${s.id}|${s.label}|${s.lang}`)
      .sort();
    const catalog = PRESS_SOURCE_CATALOG.map(s => `${s.id}|${s.label}|${s.lang}`).sort();
    expect(catalog).toEqual(agent);
  });
});

describe('feedLabelFromUrl', () => {
  it('extrait le hostname sans www', () => {
    expect(feedLabelFromUrl('https://www.blog.rust-lang.org/feed.xml')).toBe('blog.rust-lang.org');
    expect(feedLabelFromUrl('https://simonwillison.net/atom/everything/')).toBe(
      'simonwillison.net',
    );
  });

  it('retombe sur la chaîne brute si URL invalide', () => {
    expect(feedLabelFromUrl('pas-une-url')).toBe('pas-une-url');
  });
});

describe('toExcerpt', () => {
  it('retire le HTML et compresse les espaces', () => {
    expect(toExcerpt('<p>Bonjour   <b>monde</b></p>')).toBe('Bonjour monde');
  });

  it('tronque au-delà de la limite', () => {
    const out = toExcerpt('a'.repeat(600), 100);
    expect(out.length).toBe(101); // 100 + ellipse
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('cutAtSentence', () => {
  it('rend le texte intact sous la limite', () => {
    expect(cutAtSentence('Une phrase courte.', 100)).toBe('Une phrase courte.');
  });

  it('coupe à la dernière fin de phrase avant la limite', () => {
    const texte =
      'La première phrase fait une taille raisonnable pour être conservée entière. ' +
      'La deuxième phrase sera sacrifiée car elle dépasse largement la limite fixée ici.';
    const out = cutAtSentence(texte, 100);
    expect(out).toBe('La première phrase fait une taille raisonnable pour être conservée entière.');
  });

  it("coupe au mot + ellipse quand aucune phrase complète n'est assez longue", () => {
    const out = cutAtSentence('Court. ' + 'mot '.repeat(60), 100);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(101);
    // Pas de coupe en plein mot.
    expect(out).not.toMatch(/mo…$/);
  });
});

describe('parseFeed', () => {
  it('parse un flux RSS 2.0', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>Rust 2.0 sort</title><link>https://example.com/rust</link><pubDate>Tue, 10 Jun 2025 08:00:00 GMT</pubDate><description>&lt;p&gt;La nouvelle version arrive.&lt;/p&gt;</description></item>
      <item><title><![CDATA[IA & vous]]></title><link>https://example.com/ai</link></item>
    </channel></rss>`;
    const items = parseFeed(xml, 'Test');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Rust 2.0 sort',
      url: 'https://example.com/rust',
      source: 'Test',
    });
    expect(items[0]!.publishedAt).toBeDefined();
    expect(items[0]!.excerpt).toBe('La nouvelle version arrive.'); // description nettoyée du HTML
    expect(items[1]!.title).toBe('IA & vous'); // CDATA + entité décodés
    expect(items[1]!.excerpt).toBeUndefined();
  });

  it('parse un flux Atom avec link href', () => {
    const xml = `<feed>
      <entry><title>Atom news</title><link href="https://example.com/atom" rel="alternate"/><published>2025-06-10T08:00:00Z</published></entry>
    </feed>`;
    const items = parseFeed(xml, 'Atom');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Atom news', url: 'https://example.com/atom' });
  });

  it('ignore les items sans titre ou sans lien', () => {
    const xml = `<rss><item><link>https://x.com/a</link></item><item><title>Sans lien</title></item></rss>`;
    expect(parseFeed(xml, 'X')).toHaveLength(0);
  });

  it('choisit rel="alternate" dans un entry Atom multi-liens (self en premier)', () => {
    // Cause du bug des dailys : prendre le PREMIER href renvoyait le flux (ou
    // l'accueil du site) — tout l'enrichissement aval lisait la mauvaise page.
    const xml = `<feed><entry>
      <title>Mon article</title>
      <link rel="self" href="https://blog.example/feed.xml"/>
      <link rel="alternate" href="https://blog.example/posts/mon-article"/>
    </entry></feed>`;
    const items = parseFeed(xml, 'Blog');
    expect(items[0]!.url).toBe('https://blog.example/posts/mon-article');
  });

  it('sans rel="alternate", préfère un <link> sans rel au <link rel="self">', () => {
    const xml = `<feed><entry>
      <title>Autre article</title>
      <link rel="self" href="https://blog.example/feed.xml"/>
      <link href="https://blog.example/posts/autre"/>
    </entry></feed>`;
    expect(parseFeed(xml, 'Blog')[0]!.url).toBe('https://blog.example/posts/autre');
  });
});

describe('dedupeItems', () => {
  it('supprime les doublons par URL et par titre', () => {
    const items: NewsItem[] = [
      { title: 'GPT-5 annoncé', url: 'https://a.com/gpt5', source: 'A' },
      { title: 'GPT-5 annoncé', url: 'https://b.com/other', source: 'B' }, // même titre
      { title: 'Autre', url: 'https://a.com/gpt5/', source: 'A' }, // même URL (slash final)
      { title: 'Nouvelle distincte', url: 'https://c.com/x', source: 'C' },
    ];
    const out = dedupeItems(items);
    expect(out).toHaveLength(2);
    expect(out.map(i => i.source)).toEqual(['A', 'C']);
  });
});

describe('filterByTopics', () => {
  const items: NewsItem[] = [
    { title: 'New React 19 features', url: 'https://x/1', source: 'X' },
    { title: 'Rust async update', url: 'https://x/2', source: 'X' },
  ];

  it('garde tout si aucun sujet', () => {
    expect(filterByTopics(items, [])).toHaveLength(2);
  });

  it('filtre par mot-clé insensible à la casse', () => {
    expect(filterByTopics(items, ['react']).map(i => i.title)).toEqual(['New React 19 features']);
  });

  it("matche aussi sur l'extrait, pas seulement le titre", () => {
    const withExcerpt: NewsItem[] = [
      {
        title: 'Un titre neutre',
        url: 'https://x/1',
        source: 'X',
        excerpt: 'Cet article parle de Kubernetes en profondeur.',
      },
      { title: 'Autre titre', url: 'https://x/2', source: 'X', excerpt: 'Rien à voir.' },
    ];
    expect(filterByTopics(withExcerpt, ['kubernetes']).map(i => i.url)).toEqual(['https://x/1']);
  });
});

describe('safeRegex', () => {
  it('renvoie null pour vide ou invalide', () => {
    expect(safeRegex(null)).toBeNull();
    expect(safeRegex('')).toBeNull();
    expect(safeRegex('(non fermé')).toBeNull();
  });

  it('compile un motif valide (insensible à la casse)', () => {
    const re = safeRegex('ia');
    expect(re).not.toBeNull();
    expect(re!.test('Une IA générative')).toBe(true);
  });
});

describe('filterByRegex', () => {
  const items: NewsItem[] = [
    { title: 'Une IA générative', url: 'https://x/1', source: 'X' },
    { title: 'Marché boursier', url: 'https://x/2', source: 'X', excerpt: 'contenu sponsorisé' },
    { title: 'Note LLM', url: 'https://x/3', source: 'X' },
  ];

  it('garde tout si aucun motif', () => {
    expect(filterByRegex(items, null, null)).toHaveLength(3);
  });

  it('inclure ne garde que ce qui matche (titre + extrait)', () => {
    expect(filterByRegex(items, '(IA|LLM)', null).map(i => i.url)).toEqual([
      'https://x/1',
      'https://x/3',
    ]);
  });

  it('exclure retire ce qui matche', () => {
    expect(filterByRegex(items, null, 'sponsoris').map(i => i.url)).toEqual([
      'https://x/1',
      'https://x/3',
    ]);
  });

  it('combine inclure et exclure', () => {
    const out = filterByRegex(items, '.', 'sponsoris').map(i => i.url);
    expect(out).toEqual(['https://x/1', 'https://x/3']);
  });

  it('ignore un motif invalide (traité comme absent)', () => {
    expect(filterByRegex(items, '(pasfermé', null)).toHaveLength(3);
  });
});

describe('filterByAge', () => {
  const now = Date.parse('2025-06-10T12:00:00Z');
  const items: NewsItem[] = [
    { title: 'récent', url: 'https://x/1', source: 'X', publishedAt: '2025-06-10T06:00:00Z' },
    { title: 'vieux', url: 'https://x/2', source: 'X', publishedAt: '2025-06-01T06:00:00Z' },
    { title: 'sans date', url: 'https://x/3', source: 'X' },
  ];

  it('garde les articles dans la fenêtre et ceux sans date', () => {
    const out = filterByAge(items, 24, now);
    expect(out.map(i => i.title)).toEqual(['récent', 'sans date']);
  });

  it('ne filtre rien si since_hours <= 0', () => {
    expect(filterByAge(items, 0, now)).toHaveLength(3);
  });
});

describe('rankItems', () => {
  it('classe par points décroissants puis par récence', () => {
    const items: NewsItem[] = [
      {
        title: 'b',
        url: 'https://x/b',
        source: 'X',
        points: 10,
        publishedAt: '2025-06-10T01:00:00Z',
      },
      { title: 'a', url: 'https://x/a', source: 'X', points: 100 },
      {
        title: 'c',
        url: 'https://x/c',
        source: 'X',
        points: 10,
        publishedAt: '2025-06-10T05:00:00Z',
      },
    ];
    expect(rankItems(items).map(i => i.title)).toEqual(['a', 'c', 'b']);
  });
});
