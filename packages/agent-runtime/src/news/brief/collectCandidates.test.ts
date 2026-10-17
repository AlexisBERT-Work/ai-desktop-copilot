import { describe, expect, it } from 'vitest';
import { feedItemImage, parseFeed } from '../parseFeed';
import { toCandidates } from './collectCandidates';

describe('feedItemImage', () => {
  it('prend media:content de type image', () => {
    const block =
      '<item><media:content url="https://cdn.ex.com/a.jpg" medium="image"/><media:content url="https://cdn.ex.com/v.mp4" medium="video"/></item>';
    expect(feedItemImage(block)).toBe('https://cdn.ex.com/a.jpg');
  });

  it('ignore une vidéo et prend une enclosure image', () => {
    const block =
      '<item><media:content url="https://cdn.ex.com/v.mp4" medium="video"/><enclosure url="https://cdn.ex.com/b.png" type="image/png"/></item>';
    expect(feedItemImage(block)).toBe('https://cdn.ex.com/b.png');
  });

  it('se rabat sur la première <img>, même encodée dans la description', () => {
    const block =
      '<item><description>&lt;p&gt;&lt;img src=&quot;https://ex.com/c.webp?w=800&amp;h=400&quot;/&gt;Texte&lt;/p&gt;</description></item>';
    expect(feedItemImage(block)).toBe('https://ex.com/c.webp?w=800&h=400');
  });

  it('refuse une URL non http(s) et renvoie undefined sans image', () => {
    expect(feedItemImage('<item><img src="data:image/png;base64,AAA"/></item>')).toBeUndefined();
    expect(feedItemImage('<item><title>x</title></item>')).toBeUndefined();
  });

  it('parseFeed porte l’image sur l’article', () => {
    const xml =
      '<rss><channel><item><title>T</title><link>https://ex.com/t</link><enclosure url="https://ex.com/t.jpg" type="image/jpeg"/></item></channel></rss>';
    expect(parseFeed(xml, 'Ex')[0]?.image).toBe('https://ex.com/t.jpg');
  });
});

describe('toCandidates', () => {
  it('numérote, rabote l’extrait, renseigne la langue de la source', () => {
    const [c] = toCandidates([
      {
        title: 'Titre',
        url: 'https://www.actuia.com/x',
        source: 'ActuIA',
        excerpt: 'Une phrase. '.repeat(80),
      },
    ]);
    expect(c).toMatchObject({ id: 'a1', lang: 'fr', publishedAt: null, image: null });
    expect(c!.excerpt.length).toBeLessThanOrEqual(601);
  });
});
