import { httpGet, httpGetBinary } from '../../lib/http';
import { decodeEntities } from '../newsText';
import type { Brief } from './briefSchema';
import type { Candidate } from './collectCandidates';
import type { LeadVisuals } from './renderBrief';
import { createLogger } from '../../logger';

// Visuels du brief : images d'articles et schémas, téléchargés pour être
// JOINTS au mail (les messageries pro bloquent souvent les images distantes).
// Best-effort : un visuel introuvable donne « pas de visuel », jamais une erreur.

const log = createLogger('news:brief-assets');

const IMAGE_TYPE = /^image\/(png|jpe?g|gif|webp)\b/i;
const MAX_IMAGE_BYTES = 2_500_000;

export interface ImageAsset {
  /** Identifiant du visuel (sert de Content-ID dans le mail). */
  id: string;
  body: Buffer;
  contentType: string;
}

export interface BriefAssets {
  /** Un élément par sujet « À la une ». */
  visuals: LeadVisuals[];
  images: ImageAsset[];
}

/** Image de partage d'une page (og:image, à défaut twitter:image). Pur, exporté pour tests. */
export function pageImage(html: string): string | null {
  for (const key of ['og:image', 'twitter:image']) {
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      if (!new RegExp(`(?:property|name)=["']${key}["']`, 'i').test(tag)) continue;
      const content = /content=["']([^"']+)["']/i.exec(tag)?.[1];
      const url = content ? decodeEntities(content) : '';
      if (/^https?:\/\//i.test(url)) return url;
    }
  }
  return null;
}

/**
 * Orientation lisible dans une colonne de mail : une chaîne horizontale de
 * plus de 4 nœuds devient illisible une fois réduite à 600 px (essai du
 * 2026-10-17), elle passe donc à la verticale. Pur, exporté pour tests.
 */
export function layoutDiagram(mermaid: string): { code: string; vertical: boolean } {
  const code = mermaid.trim();
  const header = /^(\s*(?:flowchart|graph))\s+(LR|RL|TD|TB|BT)\b/i.exec(code);
  if (header === null) return { code, vertical: false };
  const direction = header[2]!.toUpperCase();
  if (direction !== 'LR' && direction !== 'RL') return { code, vertical: true };
  // 4 liens ou plus ≈ plus de 4 nœuds en chaîne.
  const edges = code.match(/-->|---|==>|-\.->/g)?.length ?? 0;
  return edges >= 4
    ? { code: code.replace(header[0], `${header[1]} TD`), vertical: true }
    : { code, vertical: false };
}

/** Dimensions d'un PNG lues dans son en-tête IHDR, ou null si ce n'est pas un PNG. Pur. */
export function pngSize(png: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (png.length < 24 || !png.subarray(0, 8).equals(signature)) return null;
  if (png.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** URL de rendu PNG d'un schéma Mermaid (mermaid.ink, thème sobre). Pur, exporté pour tests. */
export function diagramUrl(mermaid: string): string {
  const code = Buffer.from(mermaid.trim(), 'utf-8').toString('base64url');
  return `https://mermaid.ink/img/${code}?type=png&bgColor=!white&theme=neutral&width=1200`;
}

export interface AssetDeps {
  fetchBinary: typeof httpGetBinary;
  fetchText: typeof httpGet;
}

const DEFAULT_DEPS: AssetDeps = { fetchBinary: httpGetBinary, fetchText: httpGet };

async function fetchImage(url: string, id: string, deps: AssetDeps): Promise<ImageAsset | null> {
  try {
    const { body, contentType } = await deps.fetchBinary(url, {
      timeoutMs: 20_000,
      maxBytes: MAX_IMAGE_BYTES,
    });
    if (!IMAGE_TYPE.test(contentType) || body.length === 0) return null;
    return { id, body, contentType: contentType.split(';')[0]!.trim() };
  } catch (err) {
    log.warn('Visuel ignoré', { id, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * URL d'illustration d'un sujet, sans jamais faire confiance à une URL
 * inventée : l'image proposée par Claude n'est retenue que si un flux collecté
 * l'annonçait ; sinon celle qu'un flux annonçait pour l'une de ses sources ;
 * sinon l'image de partage de la page de la source principale.
 */
async function leadImageUrl(
  lead: Brief['leads'][number],
  candidates: Candidate[],
  deps: AssetDeps,
): Promise<string | null> {
  const announced = new Set(candidates.map(c => c.image).filter((u): u is string => u !== null));
  if (lead.imageUrl !== null && announced.has(lead.imageUrl)) return lead.imageUrl;
  for (const source of lead.sources) {
    const match = candidates.find(c => c.url === source.url && c.image !== null);
    if (match?.image) return match.image;
  }
  const main = lead.sources[0]?.url;
  if (main === undefined || !/^https?:\/\//i.test(main)) return null;
  try {
    return pageImage(await deps.fetchText(main, 10_000));
  } catch {
    return null;
  }
}

/** Télécharge les visuels des sujets « À la une » (en parallèle, best-effort). */
export async function buildBriefAssets(
  brief: Brief,
  candidates: Candidate[],
  deps: AssetDeps = DEFAULT_DEPS,
): Promise<BriefAssets> {
  const leads = brief.leads.slice(0, 3);
  const resolved = await Promise.all(
    leads.map(async (lead, i) => {
      const url = await leadImageUrl(lead, candidates, deps);
      const layout = lead.diagram !== null ? layoutDiagram(lead.diagram.mermaid) : null;
      const [image, diagram] = await Promise.all([
        url !== null ? fetchImage(url, `lead${i + 1}-image`, deps) : Promise.resolve(null),
        layout !== null
          ? fetchImage(diagramUrl(layout.code), `lead${i + 1}-diagram`, deps)
          : Promise.resolve(null),
      ]);
      // Largeur d'affichage selon la FORME réelle de l'image, pas la direction
      // du schéma : un `flowchart TD` qui se ramifie sort plus large que haut
      // (essai du 2026-10-17), et rétréci, ses libellés devenaient illisibles.
      const size = diagram !== null ? pngSize(diagram.body) : null;
      const tall = size !== null ? size.height > size.width : layout?.vertical === true;
      return { image, diagram, vertical: tall };
    }),
  );

  // Deux sujets illustrés par la même image (même flux) : on la garde au premier.
  const seen = new Set<string>();
  const images: ImageAsset[] = [];
  const visuals: LeadVisuals[] = resolved.map(({ image, diagram, vertical }) => {
    const digest = image ? image.body.toString('base64').slice(0, 200) : '';
    const keep = image !== null && !seen.has(digest);
    if (keep) {
      seen.add(digest);
      images.push(image);
    }
    if (diagram !== null) images.push(diagram);
    return {
      image: keep ? image.id : null,
      diagram: diagram?.id ?? null,
      ...(diagram !== null && vertical ? { diagramVertical: true } : {}),
    };
  });
  return { visuals, images };
}
