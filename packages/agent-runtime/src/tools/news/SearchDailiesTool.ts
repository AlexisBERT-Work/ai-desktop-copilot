import { z } from 'zod';
import type { Daily, ToolResult } from '@catdesk/shared-types';
import { DAILY_CATEGORIES } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { SharedDailiesResult } from '../../news/SharedDailyReader';

// ─── Dépendances (interfaces étroites → testable sans stores réels) ──

/** Source des dailys locales (LocalDailyStore). */
export interface LocalDailySource {
  list(): Daily[];
}

/** Source des dailys partagées (SharedDailyReader). */
export interface SharedDailySource {
  fetch(): Promise<SharedDailiesResult>;
}

// ─── Arguments ────────────────────────────────────────────────

const argsSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'Mots-clés à chercher dans les articles (titre + contenu), ex. "Nvidia résultats". Omis = les dailys les plus récentes',
    ),
  category: z
    .enum(DAILY_CATEGORIES)
    .optional()
    .describe('Filtre par catégorie: markets, tech, crypto, macro, product, misc'),
  days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(7)
    .describe('Fenêtre de recherche en jours (défaut 7, max 30)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3)
    .describe('Nombre max de dailys renvoyées (défaut 3)'),
  full_text: z
    .boolean()
    .default(false)
    .describe(
      "Renvoyer le texte complet des dailys au lieu des seuls extraits correspondant à query (plus lent — réserver aux demandes de résumé d'une daily entière)",
    ),
});
type Args = z.infer<typeof argsSchema>;

// ─── Scoring plein-texte léger (même esprit que selectTools) ──

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ');
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter(w => w.length >= 3)
    .map(w => w.replace(/(s|es|ees|er|ent)$/u, ''));
}

function scoreText(text: string, qWords: string[]): number {
  const hay = new Set(tokens(text));
  let s = 0;
  for (const w of qWords) {
    for (const h of hay) {
      if (h === w || h.startsWith(w) || w.startsWith(h)) {
        s++;
        break;
      }
    }
  }
  return s;
}

function scoreDaily(d: Daily, qWords: string[]): number {
  if (qWords.length === 0) return 0;
  // Le titre pèse plus (journal + date + sujet).
  return scoreText(d.title, qWords) * 3 + scoreText(d.body, qWords);
}

// ─── Extraits ─────────────────────────────────────────────────
// Renvoyer 3 corps complets (jusqu'à 12 000 car.) faisait exploser le prompt :
// évaluation lente sur GPU local ET réponse qui déballe toute la daily au lieu
// de filtrer. Avec une query, on ne renvoie que les blocs (puces/paragraphes du
// Markdown du pipeline) qui matchent — ~10× moins de tokens, réponse ciblée.

const EXCERPT_MAX_BLOCKS = 6;
const EXCERPT_CAP = 1500;
const BODY_CAP = 4000;

function splitBlocks(body: string): string[] {
  return body
    .split(/\n{2,}|\n(?=[-*•#]|\d+\.\s)/)
    .map(b => b.trim())
    .filter(b => b.length > 0);
}

/** Blocs du corps qui matchent la query, en ordre de lecture. `null` si aucun. */
function extractExcerpt(body: string, qWords: string[]): string | null {
  const matching = splitBlocks(body)
    .map(b => ({ b, s: scoreText(b, qWords) }))
    .filter(x => x.s > 0)
    .slice(0, EXCERPT_MAX_BLOCKS)
    .map(x => x.b);
  if (matching.length === 0) return null;
  const joined = matching.join('\n');
  return joined.length > EXCERPT_CAP ? `${joined.slice(0, EXCERPT_CAP)}… [tronqué]` : joined;
}

function capBody(body: string): string {
  return body.length > BODY_CAP ? `${body.slice(0, BODY_CAP)}… [tronqué]` : body;
}

/**
 * Donne à l'agent l'accès en lecture aux revues de presse (dailys) — locales
 * (« Mes journaux ») ET partagées (Supabase) — pour répondre aux questions sur
 * les articles. Fusionne les deux flux, filtre par mots-clés/catégorie/fenêtre,
 * et renvoie les extraits pertinents (ou le texte complet sur demande).
 */
export class SearchDailiesTool extends BaseTool<Args> {
  readonly name = 'search_dailies';
  readonly description =
    "Recherche et lit les revues de presse quotidiennes (dailys) déjà générées : articles, journaux, actualités collectées — locales et partagées. À utiliser EN PREMIER pour toute question sur les articles, un journal ou l'actualité.";
  readonly category = 'web' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(
    private readonly local: LocalDailySource,
    private readonly shared: SharedDailySource,
  ) {
    super();
  }

  async execute(args: Args): Promise<ToolResult> {
    const now = Date.now();
    const sharedResult = await this.shared.fetch();

    // Fusion locales + partagées, hors expirées, dédoublonnée par titre
    // (run local + publication partagée d'un même journal → on garde la plus récente).
    const byTitle = new Map<string, Daily>();
    const localItems = this.local.list().map(d => ({ ...d, origin: 'local' as const }));
    for (const d of [...localItems, ...sharedResult.items]) {
      if (d.expiresAt !== null && Date.parse(d.expiresAt) < now) continue;
      const prev = byTitle.get(d.title);
      if (prev === undefined || Date.parse(d.publishedAt) > Date.parse(prev.publishedAt)) {
        byTitle.set(d.title, d);
      }
    }

    const cutoff = now - args.days * 24 * 60 * 60 * 1000;
    const inWindow = [...byTitle.values()].filter(d => {
      const t = Date.parse(d.publishedAt);
      if (!Number.isNaN(t) && t < cutoff) return false;
      return args.category === undefined || d.category === args.category;
    });

    const qWords = args.query !== undefined ? tokens(args.query) : [];
    const excerptMode = qWords.length > 0 && !args.full_text;
    const ranked = inWindow
      .map(d => ({ d, s: scoreDaily(d, qWords) }))
      .filter(x => qWords.length === 0 || x.s > 0)
      .sort((a, b) => b.s - a.s || Date.parse(b.d.publishedAt) - Date.parse(a.d.publishedAt))
      .slice(0, args.limit)
      .map(({ d }) => ({
        title: d.title,
        category: d.category,
        origin: d.origin ?? 'shared',
        publishedAt: d.publishedAt,
        // Extraits pertinents seulement (repli : début du corps si seul le
        // titre matche) ; corps complet borné sans query ou avec full_text.
        body: excerptMode
          ? (extractExcerpt(d.body, qWords) ?? `${d.body.slice(0, 500)}…`)
          : capBody(d.body),
      }));

    // Aucune correspondance : donner au LLM la liste de ce qui existe pour
    // qu'il reformule ou réponde « pas couvert » en connaissance de cause.
    const availableTitles =
      ranked.length === 0
        ? inWindow
            .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
            .slice(0, 15)
            .map(d => `${d.title} (${d.category}, ${d.publishedAt.slice(0, 10)})`)
        : undefined;

    return this.ok(
      {
        dailies: ranked,
        contentMode: excerptMode ? 'extraits pertinents' : 'texte complet',
        totalInWindow: inWindow.length,
        ...(availableTitles !== undefined ? { availableTitles } : {}),
        // Reformulé pour ne pas déclencher une relance : les locales sont déjà là.
        ...(sharedResult.error !== undefined
          ? {
              sharedSourceNote: `${sharedResult.error} Les dailys locales sont déjà incluses ci-dessus — inutile de relancer la recherche pour ça.`,
            }
          : {}),
      },
      { local: localItems.length, shared: sharedResult.items.length },
    );
  }
}
