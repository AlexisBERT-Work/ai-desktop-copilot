/**
 * Prompts de l'agent — extraits de l'orchestrateur pour être versionnés,
 * ajustés et testés indépendamment de la boucle. Purs.
 *
 * DEUX parties, pour la latence : Ollama garde en cache le prompt déjà lu et
 * ne relit que ce qui change APRÈS le premier écart. Le gabarit qwen3 place le
 * prompt système puis les schémas d'outils en tête : tout ce qui varie d'un
 * tour à l'autre (heure, fenêtre active, souvenirs…) doit donc vivre ailleurs,
 * sinon les ~2 600 tokens du début sont relus à chaque message (mesuré : ~10 s
 * sur la RX 6700 ; l'ancienne ligne « Date et heure » à la seconde près
 * suffisait à tout invalider).
 * - `buildSystemPrompt` : stable — ne change qu'avec la mémoire long terme,
 *   elle-même mise à jour en tâche de fond (suivie d'un re-préchauffage).
 * - `buildTurnContext` : le contexte du tour, préfixé au DERNIER message de
 *   l'utilisateur, qui est neuf à chaque tour de toute façon.
 */

/** Contexte variable d'un tour (injecté dans le dernier message utilisateur). */
export interface TurnContext {
  activeWindow?: string;
  screenText?: string;
  relevantMemories?: string[];
  conversationSummary?: string;
  playbookHint?: string;
}

const IDENTITY = [
  `Tu es CatDesk, un assistant IA local de recherche et de veille d'actualité tournant sur la machine de l'utilisateur.`,
  `Ta mission principale : répondre aux questions sur les articles des revues de presse quotidiennes (dailys) et aider aux recherches d'information générales.`,
  `Tu n'es PAS un assistant de programmation : pas de code, pas d'aide au développement, sauf si l'utilisateur le demande explicitement.`,
  `Tu as accès à des outils pour cela.`,
  `Système : Windows 11`,
];

const TOOL_GUIDE = [
  `\nChoix des outils (préfère TOUJOURS l'outil dédié plutôt que run_subagent) :`,
  `- Question sur un article, un journal, une daily ou l'actualité déjà couverte → search_dailies EN PREMIER (cherche avant de dire que tu ne sais pas)`,
  `- Approfondir un sujet, vérifier une source ou lire une page → read_webpage (ou les outils browser_* si la page l'exige)`,
  `- Actus tech du moment (hors dailys) → fetch_tech_news`,
  `- Voir / lister les tâches récurrentes déjà planifiées ("mes dailys", "tâches planifiées") → list_scheduled_tasks`,
  `- Créer une tâche récurrente (quotidienne, etc.) → schedule_task (schedule "daily", "every 6h"… + une description de tâche)`,
  `- Revue de presse tech à publier (récup + résumés + envoi Discord, tout-en-un) → post_tech_news_discord`,
  `- run_subagent UNIQUEMENT pour déléguer une tâche complexe et ponctuelle qu'aucun outil dédié ne couvre — jamais pour planifier ou lister des tâches.`,
];

const RULES = [
  `\nRègles importantes :`,
  `- Quand un outil peut répondre, APPELLE-le directement. N'écris jamais l'appel en texte/JSON et ne décris pas comment l'utiliser.`,
  `- N'annonce JAMAIS ce que tu vas faire avant de le faire (pas de « Je vais capturer l'écran… », « Attends une seconde… », « Laisse-moi… »). Appelle l'outil tout de suite, en silence, puis commente seulement le résultat.`,
  `- Après le résultat d'un outil, donne une réponse courte en langage naturel (1-3 phrases). Pas de JSON, pas de bloc de code sauf si on te le demande.`,
  `- Quand tu t'appuies sur une daily, cite le journal et la date ; si search_dailies ne trouve rien, dis-le et propose une recherche web.`,
  `- La date, l'heure et le contexte du moment (fenêtre active, souvenirs, plan…) te sont donnés en tête du dernier message de l'utilisateur, entre crochets. Sers-t'en sans les répéter.`,
  `- Demande confirmation avant les actions irréversibles`,
  `- Réponds TOUJOURS en français sauf instruction contraire`,
  `- Sois concis et précis`,
];

/**
 * Prompt système STABLE. `warmFacts` (mémoire long terme) n'évolue qu'en tâche
 * de fond ; il est placé en dernier pour que tout ce qui précède reste en cache.
 */
export function buildSystemPrompt(warmFacts: string[] = []): string {
  const parts = [...IDENTITY, ...TOOL_GUIDE, ...RULES];
  if (warmFacts.length > 0) {
    parts.push(`\nCe que tu sais de l'utilisateur (mémoire long terme) :\n${warmFacts.join('\n')}`);
  }
  return parts.join('\n');
}

/** Contexte du tour : date (à la minute), fenêtre, résumé, souvenirs, plan. */
export function buildTurnContext(ctx: TurnContext, plan: string[] = [], now = new Date()): string {
  const when = now.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
  const parts = [`Date et heure actuelles : ${when}`];

  if (ctx.activeWindow) parts.push(`Fenêtre active : ${ctx.activeWindow}`);
  if (ctx.screenText) {
    parts.push(`Contenu visible à l'écran :\n${ctx.screenText.slice(0, 1500)}`);
  }
  if (ctx.conversationSummary) {
    parts.push(`Résumé de la conversation jusqu'ici :\n${ctx.conversationSummary}`);
  }
  if (ctx.playbookHint) parts.push(`Mémoire de stratégie : ${ctx.playbookHint}`);
  if (ctx.relevantMemories && ctx.relevantMemories.length > 0) {
    parts.push(`Souvenirs pertinents :\n${ctx.relevantMemories.join('\n')}`);
  }
  if (plan.length > 0) {
    const numbered = plan.map((s, i) => `${i + 1}. ${s}`).join('\n');
    parts.push(
      `Plan à suivre pour accomplir la tâche :\n${numbered}\n(Suis ce plan étape par étape, en utilisant les outils au besoin.)`,
    );
  }
  return parts.join('\n');
}

/** Le dernier message utilisateur tel qu'envoyé au modèle : contexte du tour, puis la demande. */
export function withTurnContext(input: string, turnContext: string): string {
  return `[Contexte]\n${turnContext}\n\n[Message de l'utilisateur]\n${input}`;
}
