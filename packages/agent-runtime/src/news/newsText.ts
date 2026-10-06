// Helpers de texte des flux : décodage d'entités, extraction de balise, coupe
// propre. Purs, exportés pour les tests.

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}

export function tagContent(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
  return m ? decodeEntities(m[1]!) : null;
}

/**
 * Coupe un texte trop long à la dernière fin de phrase avant `max` ; à défaut
 * (aucune phrase complète assez longue), au dernier mot entier + « … ». Une
 * coupe brute en pleine phrase (« This is pure raw The… ») rend illisible tout
 * ce qui cite ou résume ce texte ensuite. Pur, exporté pour tests.
 */
export function cutAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  let end = -1;
  const re = /[.!?…](?=\s)/g;
  for (let m = re.exec(slice); m !== null; m = re.exec(slice)) end = m.index + 1;
  // Une « phrase » qui n'occupe pas au moins 40 % du budget est trop maigre :
  // mieux vaut couper au mot que de réduire l'extrait à presque rien.
  if (end >= max * 0.4) return slice.slice(0, end).trimEnd();
  return `${slice.replace(/\s+\S*$/, '').trimEnd()}…`;
}

// Strip residual HTML from a feed description into a short plain-text teaser.
export function toExcerpt(raw: string, max = 500): string {
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cutAtSentence(text, max);
}
