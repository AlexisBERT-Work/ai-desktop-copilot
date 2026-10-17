import type { NewsItem } from './newsItem';
import { decodeEntities, tagContent, toExcerpt } from './newsText';

/**
 * Illustration d'un article de flux, dans l'ordre de fiabilité :
 * `media:content`/`media:thumbnail` (Media RSS), `enclosure` de type image,
 * puis la première `<img>` du contenu. Seules les URLs http(s) sont gardées.
 * Pur, exporté pour tests.
 */
export function feedItemImage(block: string): string | undefined {
  const candidates: string[] = [];
  for (const tag of block.match(/<media:(?:content|thumbnail)\b[^>]*>/gi) ?? []) {
    if (/medium=["'](?!image)/i.test(tag) || /type=["'](?!image)/i.test(tag)) continue;
    const url = /url=["']([^"']+)["']/i.exec(tag)?.[1];
    if (url) candidates.push(url);
  }
  for (const tag of block.match(/<enclosure\b[^>]*>/gi) ?? []) {
    if (!/type=["']image\//i.test(tag)) continue;
    const url = /url=["']([^"']+)["']/i.exec(tag)?.[1];
    if (url) candidates.push(url);
  }
  // Dans le contenu, l'<img> est souvent encodée (&lt;img src=&quot;…&quot;&gt;).
  const img = /<img\b[^>]*?src=["']([^"']+)["']/i.exec(decodeEntities(block))?.[1];
  if (img) candidates.push(img);
  return candidates.map(u => decodeEntities(u)).find(u => /^https?:\/\//i.test(u));
}

/** Parse an RSS 2.0 or Atom feed into news items. Resilient to formatting. */
export function parseFeed(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];

  // RSS <item> first, fall back to Atom <entry>.
  const blocks =
    xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];

  for (const block of blocks) {
    const title = tagContent(block, 'title');
    if (!title) continue;

    // RSS: <link>url</link> ; Atom: <link href="url" .../> — un <entry> Atom
    // porte souvent PLUSIEURS <link> (alternate = l'article, self = le flux,
    // replies…) : prendre le premier href revoyait parfois vers l'accueil du
    // site, et tout l'enrichissement aval lisait la mauvaise page.
    let url = tagContent(block, 'link');
    if (!url) {
      const tags = block.match(/<link\b[^>]*>/gi) ?? [];
      const best =
        tags.find(t => /rel=["']alternate["']/i.test(t)) ??
        tags.find(t => !/\brel=/i.test(t)) ??
        tags[0];
      const href = best ? /href=["']([^"']+)["']/i.exec(best) : null;
      url = href?.[1] ? decodeEntities(href[1]) : null;
    }
    if (!url) continue;

    const dateRaw =
      tagContent(block, 'pubDate') ??
      tagContent(block, 'published') ??
      tagContent(block, 'updated') ??
      tagContent(block, 'dc:date');
    const ts = dateRaw ? Date.parse(dateRaw) : NaN;

    const descRaw =
      tagContent(block, 'description') ??
      tagContent(block, 'content:encoded') ??
      tagContent(block, 'summary') ??
      tagContent(block, 'content');
    const excerpt = descRaw ? toExcerpt(descRaw) : '';
    const image = feedItemImage(block);

    items.push({
      title,
      url,
      source,
      ...(Number.isNaN(ts) ? {} : { publishedAt: new Date(ts).toISOString() }),
      ...(excerpt.length > 0 ? { excerpt } : {}),
      ...(image !== undefined ? { image } : {}),
    });
  }

  return items;
}

export function parseHackerNews(json: string): NewsItem[] {
  const data = JSON.parse(json) as { hits?: Array<Record<string, unknown>> };
  return (data.hits ?? [])
    .map((h): NewsItem | null => {
      const title = typeof h['title'] === 'string' ? h['title'] : null;
      if (!title) return null;
      const objectID = String(h['objectID'] ?? '');
      const url =
        typeof h['url'] === 'string' && h['url']
          ? h['url']
          : `https://news.ycombinator.com/item?id=${objectID}`;
      const created = typeof h['created_at'] === 'string' ? h['created_at'] : undefined;
      return {
        title,
        url,
        source: 'Hacker News',
        ...(typeof h['points'] === 'number' ? { points: h['points'] } : {}),
        ...(typeof h['num_comments'] === 'number' ? { comments: h['num_comments'] } : {}),
        ...(created ? { publishedAt: new Date(created).toISOString() } : {}),
      };
    })
    .filter((x): x is NewsItem => x !== null);
}

export function parseDevto(json: string): NewsItem[] {
  const data = JSON.parse(json) as Array<Record<string, unknown>>;
  return (Array.isArray(data) ? data : [])
    .map((a): NewsItem | null => {
      const title = typeof a['title'] === 'string' ? a['title'] : null;
      const url = typeof a['url'] === 'string' ? a['url'] : null;
      if (!title || !url) return null;
      const published = typeof a['published_at'] === 'string' ? a['published_at'] : undefined;
      const desc = typeof a['description'] === 'string' ? a['description'].trim() : '';
      return {
        title,
        url,
        source: 'DEV.to',
        ...(typeof a['positive_reactions_count'] === 'number'
          ? { points: a['positive_reactions_count'] }
          : {}),
        ...(typeof a['comments_count'] === 'number' ? { comments: a['comments_count'] } : {}),
        ...(published ? { publishedAt: new Date(published).toISOString() } : {}),
        ...(desc.length > 0 ? { excerpt: toExcerpt(desc) } : {}),
      };
    })
    .filter((x): x is NewsItem => x !== null);
}
