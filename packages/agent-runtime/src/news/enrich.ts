import type { NewsItem } from './newsItem';
import { httpGet } from '../lib/httpGet';
import { extractReadableText, looksLikeProse, startsMidSentence } from '../lib/readableText';
import { cutAtSentence, toExcerpt } from './newsText';

/**
 * Best-effort: fetch the linked page for items missing an excerpt (e.g. Hacker
 * News links) and derive a short teaser. Failures are silent — the item simply
 * keeps no excerpt. Runs in parallel; bounded by the small post limit (≤10).
 */
export async function enrichExcerpts(items: NewsItem[]): Promise<NewsItem[]> {
  await Promise.allSettled(
    items.map(async item => {
      if (item.excerpt && item.excerpt.length > 0) return;
      try {
        const html = await httpGet(item.url, 8_000);
        const text = extractReadableText(html);
        if (text.length > 80) item.excerpt = toExcerpt(text, 500);
      } catch {
        /* leave without excerpt */
      }
    }),
  );
  return items;
}

/**
 * Lecture du corps des articles : télécharge CHAQUE page liée et en garde le
 * texte PRINCIPAL (extraction lisible : cible `<article>`/`<main>`, filtre les
 * menus — voir extractReadableText), plafonné à `maxChars`, pour donner au LLM
 * bien plus de matière que le seul extrait RSS. Complète aussi au passage
 * l'extrait manquant — ou pollué (menu de site aspiré par une version
 * antérieure du fetch). Best-effort en parallèle : un échec (timeout, paywall)
 * laisse l'item avec son extrait d'origine.
 */
export async function enrichArticleTexts(items: NewsItem[], maxChars = 1500): Promise<NewsItem[]> {
  await Promise.allSettled(
    items.map(async item => {
      try {
        const html = await httpGet(item.url, 8_000);
        const text = extractReadableText(html);
        // Sous ~200 caractères, on est face à un paywall, un mur de cookies ou
        // une page sans prose : l'extrait RSS fait alors meilleure matière.
        if (text.length < 200) return;
        // Coupe à la phrase en PRÉSERVANT les sauts de paragraphe : écraser les
        // \n collait des paragraphes sans rapport en une seule « phrase ».
        item.fullText = cutAtSentence(text, maxChars);
        if (!item.excerpt || !looksLikeProse(item.excerpt, 30) || startsMidSentence(item.excerpt)) {
          item.excerpt = toExcerpt(text, 500);
        }
      } catch {
        /* garde l'extrait RSS */
      }
    }),
  );
  return items;
}
