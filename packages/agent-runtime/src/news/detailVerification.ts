import type { OllamaClient } from '../llm/OllamaClient';
import type { NewsItem } from '../tools/web/FetchTechNewsTool';
import { looksLikeProse } from '../tools/web/ReadWebpageTool';
import { articleCharBudget, complete, DIGEST_LLM_OPTS } from './digestLlm';
import { createLogger } from '../logger';

const log = createLogger('news:press-digest');

// ─── Vérification des détails (anti-invention) ─────────────────
// Deux couches, chacune pouvant rejeter un détail (rejeté = pas de bouton
// « En savoir plus » — un détail absent vaut toujours mieux qu'un détail faux) :
// 1. déterministe : les nombres du détail doivent exister dans la source ;
// 2. LLM : un passage « vérificateur de faits » compare détail et article.

/**
 * Suites de chiffres d'un texte. On ignore la ponctuation interne (séparateurs
 * de milliers « 2,500 » / « 2 500 », décimales « 8.1 » / « 8,1 ») en découpant
 * sur tout non-chiffre : robuste aux conventions FR/EN. Pur, exporté pour tests.
 */
export function digitRuns(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

/**
 * Garde-fou déterministe : chaque suite de chiffres du détail doit apparaître
 * dans la matière source — les nombres ne se traduisent pas, un chiffre
 * inconnu est une invention. Pur, exporté pour tests.
 */
export function numbersSupported(detail: string, sourceText: string): boolean {
  const source = new Set(digitRuns(sourceText));
  return digitRuns(detail).every(n => source.has(n));
}

/** Matière source d'un article pour la vérification (titre + meilleur texte). */
function sourceTextOf(it: NewsItem): string {
  return `${it.title}\n${it.fullText ?? it.excerpt ?? ''}`;
}

const VERIFY_SYSTEM = `Tu es un vérificateur de faits impitoyable. On te donne des articles (titre + texte) et, pour chacun, un paragraphe rédigé à partir de l'article.
Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte autour. Exemple exact pour 3 paragraphes : {"fidele":[true,false,true]}
- true si TOUT le contenu du paragraphe est directement soutenu par le titre et le texte de l'article correspondant.
- false si le paragraphe mentionne une personne, une organisation, un chiffre, un lieu ou un fait ABSENT du texte, ou s'il contredit le texte.
Le tableau "fidele" contient exactement un booléen JSON (sans guillemets) par paragraphe, dans le même ordre.`;

/** Invite de vérification pour les paires (article, détail) données. Pur, exporté pour tests. */
export function buildVerifyPrompt(pairs: { source: string; detail: string }[]): string {
  const blocks = pairs.map(
    (p, i) => `Article ${i + 1} :\n${p.source}\n\nParagraphe ${i + 1} :\n${p.detail}`,
  );
  return `Voici ${pairs.length} paires article/paragraphe :\n\n${blocks.join('\n\n---\n\n')}`;
}

/**
 * Parse les verdicts en exigeant `count` entrées. Null si illisible. Tolère ce
 * que qwen2.5:7b produit réellement : l'objet {"fidele":[...]} demandé, mais
 * aussi le tableau nu (["false","true"]) et les booléens en chaînes. Tout ce
 * qui n'est pas un true franc vaut false (prudence). Pur, exporté pour tests.
 */
export function parseVerifyJson(text: string, count: number): boolean[] | null {
  const toBool = (v: unknown): boolean =>
    v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
  const tryParse = (slice: string): unknown => {
    try {
      return JSON.parse(slice);
    } catch {
      return undefined;
    }
  };

  let arr: unknown;
  const os = text.indexOf('{');
  const oe = text.lastIndexOf('}');
  if (os !== -1 && oe > os) {
    const parsed = tryParse(text.slice(os, oe + 1));
    if (typeof parsed === 'object' && parsed !== null) {
      arr = (parsed as Record<string, unknown>)['fidele'];
    }
  }
  if (!Array.isArray(arr)) {
    const as = text.indexOf('[');
    const ae = text.lastIndexOf(']');
    if (as === -1 || ae <= as) return null;
    arr = tryParse(text.slice(as, ae + 1));
  }
  if (!Array.isArray(arr) || arr.length !== count) return null;
  return arr.map(toBool);
}

/**
 * Jugement LLM (température 0 : on juge, on ne rédige pas) sur des paires
 * (source, détail). Null si l'appel échoue ou si la réponse est illisible —
 * un incident d'infra n'est pas un verdict.
 */
export async function llmFactCheck(
  llm: OllamaClient,
  model: string,
  pairs: { source: string; detail: string }[],
): Promise<boolean[] | null> {
  if (pairs.length === 0) return [];
  let raw: string;
  try {
    raw = await complete(llm, model, VERIFY_SYSTEM, buildVerifyPrompt(pairs), {
      ...DIGEST_LLM_OPTS,
      temperature: 0,
    });
  } catch (err) {
    log.warn('Fact check call failed', { error: String(err) });
    return null;
  }
  return parseVerifyJson(raw, pairs.length);
}

/**
 * Marque les détails non fidèles à leur article ('' = à refaire). Couche 1
 * (nombres) locale et sûre ; couche 2 (LLM) best-effort : si le juge est
 * indisponible, on garde les détails restants — la couche 1 a déjà filtré le
 * plus flagrant.
 */
export async function verifyDetails(
  llm: OllamaClient,
  model: string,
  items: NewsItem[],
  details: string[],
): Promise<string[]> {
  // Couche 1 — nombres inventés.
  const checked = details.map((d, i) => {
    const it = items[i];
    if (d.length === 0 || it === undefined) return d;
    if (numbersSupported(d, sourceTextOf(it))) return d;
    log.warn('Detail rejected — unsupported number', { title: it.title.slice(0, 60) });
    return '';
  });

  // Couche 2 — jugement LLM sur les détails restants.
  const idx = checked.map((d, i) => (d.length > 0 ? i : -1)).filter(i => i >= 0);
  if (idx.length === 0) return checked;
  const budget = articleCharBudget(idx.length);
  const pairs = idx.map(i => ({
    source: sourceTextOf(items[i]!).slice(0, budget),
    detail: checked[i]!,
  }));

  const verdicts = await llmFactCheck(llm, model, pairs);
  if (verdicts === null) return checked;

  for (const [k, i] of idx.entries()) {
    if (verdicts[k] === false) {
      log.info('Detail rejected — failed fact check', { title: items[i]!.title.slice(0, 60) });
      checked[i] = '';
    }
  }
  return checked;
}

// ─── Régénération article par article (garantie de couverture) ─
// Le lot entier passe d'abord par verifyDetails ; chaque détail rejeté (ou
// jamais produit) est réécrit ICI avec pour seul contexte SON article — c'est
// le mélange d'articles dans une même invite qui produit les substitutions de
// noms. En dernier recours, extrait verbatim : un texte toujours présent,
// jamais inventé.

const DETAIL_SYSTEM = `Tu es un journaliste francophone rigoureux. On te donne UN article (titre + texte).
Rédige un paragraphe de 3 à 5 phrases en français qui développe le fond : ce qui s'est passé, les acteurs, les chiffres clés et le contexte.
Règles STRICTES :
- Appuie-toi UNIQUEMENT sur le titre et le texte fournis. N'ajoute AUCUNE information extérieure.
- Reprends les noms propres et les nombres EXACTEMENT tels qu'ils apparaissent dans le texte.
- Réponds avec le paragraphe seul, sans préambule ni commentaire.`;

/** Invite mono-article pour la régénération d'un détail. Pur, exporté pour tests. */
export function buildDetailPrompt(item: NewsItem): string {
  const text = item.fullText ?? item.excerpt ?? '';
  return `Titre : ${item.title}\n\nTexte de l'article :\n${text.slice(0, 1500)}`;
}

/**
 * Repli garanti fidèle : extrait verbatim de l'article (langue d'origine),
 * clairement présenté comme citation. L'extrait RSS (chapeau éditorial) est
 * préféré au texte de page. Un candidat qui ne ressemble pas à de la prose
 * (menu de site, sommaire) est écarté : citer du déchet est pire que ne rien
 * afficher. Renvoie '' si aucune matière ne vaut un bouton. Pur.
 */
export function verbatimDetail(item: NewsItem): string {
  const text =
    [item.excerpt ?? '', item.fullText ?? '']
      .map(t => t.replace(/\s+/g, ' ').trim())
      .find(t => looksLikeProse(t)) ?? '';
  if (text.length === 0) return '';
  const cut = text.length <= 350 ? text : `${text.slice(0, 350).replace(/\s+\S*$/, '')}…`;
  return `Extrait de l'article : « ${cut} »`;
}

const DETAIL_ATTEMPTS = 3;

/**
 * Produit un détail vérifié pour UN article : génération ciblée, contrôle des
 * nombres, jugement LLM, et nouvelle tentative avec feedback en cas de rejet.
 * Après DETAIL_ATTEMPTS échecs (ou LLM indisponible), repli verbatim — le
 * détail existe TOUJOURS quand l'article a un minimum de matière.
 */
export async function draftVerifiedDetail(
  llm: OllamaClient,
  model: string,
  item: NewsItem,
): Promise<string> {
  const source = sourceTextOf(item);
  let feedback = '';
  for (let attempt = 1; attempt <= DETAIL_ATTEMPTS; attempt++) {
    let d: string;
    try {
      d = (
        await complete(
          llm,
          model,
          DETAIL_SYSTEM,
          buildDetailPrompt(item) + feedback,
          DIGEST_LLM_OPTS,
        )
      )
        .replace(/\s+/g, ' ')
        .trim();
    } catch (err) {
      log.warn('Detail generation failed — verbatim fallback', {
        title: item.title.slice(0, 60),
        error: String(err),
      });
      break;
    }
    if (d.length >= 40 && numbersSupported(d, source)) {
      const verdicts = await llmFactCheck(llm, model, [
        { source: source.slice(0, 1500), detail: d },
      ]);
      // Juge indisponible ≠ détail infidèle : les nombres ont déjà été validés.
      if (verdicts === null || verdicts[0] === true) return d;
    }
    log.info('Detail attempt rejected — retrying', { title: item.title.slice(0, 60), attempt });
    feedback =
      '\n\nATTENTION : ta version précédente citait des faits absents du texte. Recommence en n’utilisant QUE des informations présentes dans le titre et le texte ci-dessus.';
  }
  return verbatimDetail(item);
}

/**
 * Garantit un détail par article : vérifie le lot issu de l'analyse groupée,
 * puis régénère individuellement chaque détail rejeté ou manquant.
 */
export async function ensureVerifiedDetails(
  llm: OllamaClient,
  model: string,
  items: NewsItem[],
  drafted: string[],
): Promise<string[]> {
  const out = await verifyDetails(llm, model, items, drafted);
  for (let i = 0; i < items.length; i++) {
    if ((out[i] ?? '').length === 0) out[i] = await draftVerifiedDetail(llm, model, items[i]!);
  }
  return out;
}
