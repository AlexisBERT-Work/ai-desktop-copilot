import { OcrSidecarClient } from './ocrSidecar';
import { CircuitBreaker } from './CircuitBreaker';
import { createLogger } from '../logger';

const log = createLogger('web:extract');

/**
 * Débruitage d'article délégué au sidecar Python (trafilatura).
 *
 * Ce module ne connaît AUCUN repli : il renvoie `null` quand il n'a rien à
 * offrir, et l'appelant enchaîne explicitement sur l'heuristique TypeScript
 * (`extractReadableText`). C'est volontaire — un repli caché ici créerait une
 * dépendance circulaire avec ReadWebpageTool et masquerait quelle extraction a
 * réellement produit le texte.
 *
 * Voir docs/veille/2026-08-16-analyse-repos-externes.md §3.3.
 */

export interface ArticleExtract {
  title: string | null;
  text: string;
  date: string | null;
  author: string | null;
  method: 'trafilatura';
}

/**
 * Un seul circuit pour toute la capacité : si trafilatura n'est pas installé,
 * l'échec est immédiat et permanent. Sans ce garde-fou, chaque article d'un
 * digest repaierait l'aller-retour + le timeout du sidecar pour rien — le
 * remède coûterait plus cher que le mal. Seuil bas et cooldown long en
 * conséquence : inutile d'insister sur une capacité absente.
 */
export const articleExtractBreaker = new CircuitBreaker({
  failureThreshold: 2,
  cooldownMs: 30 * 60 * 1000,
});

/**
 * Le JSON-RPC passe par stdin : au-delà de ~2 Mo de HTML, le coût de sérialisation
 * dépasse le gain d'extraction. Les pages d'article réelles sont loin en dessous.
 */
const MAX_HTML_BYTES = 2_000_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Extrait le contenu d'un article via le sidecar. Renvoie `null` — jamais une
 * exception — dès que ce n'est pas possible (sidecar absent, trafilatura non
 * installé, page sans article, circuit ouvert). L'appelant doit alors se replier.
 */
export async function extractArticleViaSidecar(
  html: string,
  url?: string,
): Promise<ArticleExtract | null> {
  if (html.length === 0 || html.length > MAX_HTML_BYTES) return null;

  try {
    const raw = await articleExtractBreaker.run('web.extract_article', () =>
      OcrSidecarClient.get().call(
        'web.extract_article',
        { html, ...(url !== undefined ? { url } : {}) },
        15_000,
      ),
    );

    if (!isRecord(raw)) return null;
    const text = str(raw['text']);
    if (text === null) return null;

    return {
      title: str(raw['title']),
      text,
      date: str(raw['date']),
      author: str(raw['author']),
      method: 'trafilatura',
    };
  } catch (err) {
    // Attendu et sans gravité : on log en debug pour ne pas polluer les journaux
    // d'un poste sans trafilatura, où chaque article passerait ici.
    log.debug('Sidecar extraction unavailable — falling back', {
      ...(url !== undefined ? { url } : {}),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
