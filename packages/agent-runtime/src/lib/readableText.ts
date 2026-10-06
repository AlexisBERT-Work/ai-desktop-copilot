// Conversion HTML → texte lisible et heuristiques de qualité de prose.
// Partagé par l'outil read_webpage et par le pipeline presse, qui doit juger si
// le corps récupéré d'un article est exploitable. Pur, testable.

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Minimal HTML-to-text extractor — removes tags, scripts, styles, decodes entities.
// Une ligne du résultat = un BLOC de la page (paragraphe, titre, cellule…), jamais
// une ligne du fichier source : les retours à la ligne du HTML source sont du
// pliage d'éditeur, pas de la structure. Les traiter comme des fins de ligne
// coupait les phrases en deux, et le filtre de prose aval (looksLikeProse) jetait
// le morceau sans ponctuation — d'où des extraits démarrant en cours de phrase.
export function htmlToText(html: string): string {
  // Sanctuarise les <pre> : LEURS retours à la ligne sont du contenu (code).
  const pres: string[] = [];
  const guarded = html.replace(/<pre\b[\s\S]*?<\/pre>/gi, m => {
    pres.push(m);
    return `\u0000${pres.length - 1}\u0000`;
  });
  const text = decodeHtmlEntities(
    guarded
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/[\r\n]+/g, ' ')
      .replace(
        /<\/?(?:br|p|div|li|ul|ol|h[1-6]|tr|td|th|table|section|article|blockquote|figure|figcaption|dt|dd)\b[^>]*>/gi,
        '\n',
      )
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // eslint-disable-next-line no-control-regex -- sentinelle NUL volontaire (voir plus haut)
  return text.replace(/\u0000(\d+)\u0000/g, (_, i: string) =>
    decodeHtmlEntities(pres[Number(i)]?.replace(/<[^>]+>/g, '') ?? '').trim(),
  );
}

/**
 * Le texte ressemble-t-il à de la prose (phrases rédigées) plutôt qu'à un menu
 * de navigation, une table des matières ou une liste de liens ? Heuristique :
 * assez long, ponctuation de phrase, et une minorité de mots capitalisés (les
 * menus/sommaires sont massivement en Title Case). Pur, exporté pour tests.
 */
export function looksLikeProse(text: string, minLen = 80): boolean {
  const t = text.trim();
  if (t.length < minLen) return false;
  if (!/[.!?…]/.test(t)) return false;
  const words = t.split(/\s+/).filter(w => /\p{L}/u.test(w));
  if (words.length < 5) return false;
  const caps = words.filter(w => /^\p{Lu}/u.test(w)).length;
  return caps / words.length <= 0.4;
}

/**
 * Un texte qui démarre par une minuscule a été pris EN COURS de phrase (flux
 * RSS tronqué, fragment recollé) : à écarter quand on cite ou résume — un
 * extrait qui commence au milieu d'une phrase est illisible. Pur, exporté.
 */
export function startsMidSentence(text: string): boolean {
  return /^\p{Ll}/u.test(text.trim());
}

/**
 * Extrait le CONTENU d'une page d'article, pas la page entière : cible
 * `<article>`/`<main>` quand présent, retire header/nav/aside/footer, puis ne
 * garde que les lignes qui ressemblent à de la prose. Sans cela, les 1 500
 * premiers caractères d'un blog sont le titre du site + le menu ×2 + le
 * sommaire — et tout le pipeline de digest hérite de ce déchet. Renvoie ''
 * quand rien ne ressemble à un article (paywall, mur de cookies, accueil).
 */
export function extractReadableText(html: string): string {
  let scope = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1>/gi, '');
  const main =
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(scope) ??
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(scope) ??
    /<div[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/div>/i.exec(scope);
  if (main?.[1]) scope = main[1];
  scope = scope.replace(/<(header|nav|aside|footer|form|button)\b[\s\S]*?<\/\1>/gi, '');

  return htmlToText(scope)
    .split('\n')
    .map(l => l.trim())
    .filter(l => looksLikeProse(l, 60))
    .join('\n');
}

// Extract a named element from HTML (very naive CSS selector: tag, .class, #id)
export function extractBySelector(html: string, selector: string): string | null {
  // Support simple selectors: tag, #id, .class
  let pattern: RegExp | null = null;
  if (selector.startsWith('#')) {
    const id = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/`, 'i');
  } else if (selector.startsWith('.')) {
    const cls = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`<[^>]+class=["'][^"']*${cls}[^"']*["'][^>]*>([\\s\\S]*?)<\\/`, 'i');
  } else {
    const tag = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  }
  const m = pattern.exec(html);
  return m?.[1] ?? null;
}
