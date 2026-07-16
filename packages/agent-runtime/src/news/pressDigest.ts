import type { DailyCategory } from '@catdesk/shared-types';
import type { OllamaClient } from '../llm/OllamaClient';
import {
  aggregateNews,
  categoryForSourceLabel,
  NEWS_SOURCES,
  type NewsItem,
} from '../tools/web/FetchTechNewsTool';
import { enrichArticleTexts } from '../tools/web/PostTechNewsDiscordTool';
import { analyzeJournal } from './journalAnalysis';
import {
  buildGlobalBody,
  buildGlobalSynthesis,
  globalTitle,
  type JournalEntry,
} from './globalSynthesis';
import { createLogger } from '../logger';

// Pipeline éclaté par étape — ce module garde l'orchestration et le rendu des
// journaux ; les étapes vivent dans leur fichier et restent réexportées ici :
// - digestLlm.ts : plomberie LLM commune (complete, budgets, options) ;
// - journalAnalysis.ts : analyse intra-journal (prompt, parsing, repli) ;
// - detailVerification.ts : anti-invention (nombres, fact-check, régénération) ;
// - globalSynthesis.ts : synthèse transversale.
export * from './digestLlm';
export * from './journalAnalysis';
export * from './detailVerification';
export * from './globalSynthesis';

const log = createLogger('news:press-digest');

/** Une daily prête à publier : l'analyse du jour d'UN journal. */
export interface JournalDraft {
  journal: string;
  category: DailyCategory;
  title: string;
  body: string; // Markdown
}

/** Titre lisible et daté d'une revue de journal. Pur. */
export function journalTitle(journal: string, now = new Date()): string {
  const date = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `${journal} — revue du ${date}`;
}

/**
 * Corps Markdown : analyse + liste d'articles (résumé + lien). Le paragraphe
 * détaillé d'un article devient un blockquote imbriqué sous sa puce — l'UI le
 * replie derrière « En savoir plus » (NewsMarkdown), Discord le retire. Pur.
 */
export function buildJournalBody(
  analysis: string,
  items: NewsItem[],
  summaries: string[],
  details: string[] = [],
): string {
  const blocks: string[] = [];
  if (analysis.length > 0) blocks.push(analysis);

  const bullets = items
    .map((it, i) => {
      const s = typeof summaries[i] === 'string' ? summaries[i]!.trim() : '';
      const tail = s.length > 0 ? ` — ${s}` : '';
      const line = `- [${it.title}](${it.url})${tail}`;
      // Un détail multi-lignes casserait la liste : on l'aplatit. Un détail qui
      // répète le résumé n'apporte rien : on l'omet.
      const d = typeof details[i] === 'string' ? details[i]!.replace(/\s+/g, ' ').trim() : '';
      return d.length > 0 && d !== s ? `${line}\n  > ${d}` : line;
    })
    .join('\n');
  if (bullets.length > 0) blocks.push(bullets);

  return blocks.join('\n\n');
}

export interface PressDigestDeps {
  llm: OllamaClient;
  model: string;
  /** Ids de sources (clés de NEWS_SOURCES). */
  sourceIds: string[];
  /** Mots-clés de filtrage (« recherche de caractères ») dans titre + extrait. */
  topics: string[];
  sinceHours: number;
  /** Articles max par journal. */
  perJournalLimit: number;
  /** Ajoute une daily « Synthèse du jour » transversale en tête. */
  synthesis: boolean;
  now?: Date;
}

/**
 * Construit une daily par journal : agrège les articles du jour de chaque source,
 * applique le filtre par mots-clés, puis demande au LLM une analyse intra-journal
 * + un résumé par article. Une source sans article (ou en échec) est ignorée.
 */
export async function buildPressDailies(deps: PressDigestDeps): Promise<JournalDraft[]> {
  const { llm, model, sourceIds, topics, sinceHours, perJournalLimit } = deps;
  const now = deps.now ?? new Date();
  const ids = sourceIds.filter(id => id in NEWS_SOURCES);
  const drafts: JournalDraft[] = [];
  const analysed: JournalEntry[] = [];

  for (const id of ids) {
    let items: NewsItem[] = [];
    try {
      const res = await aggregateNews({
        sources: [id],
        topics,
        sinceHours,
        limit: perJournalLimit,
      });
      items = res.items;
    } catch (err) {
      log.warn('Source fetch failed — skipped', { id, error: String(err) });
      continue;
    }
    if (items.length === 0) continue;

    await enrichArticleTexts(items);
    const journal = NEWS_SOURCES[id]!.label;
    const { analysis, summaries, details } = await analyzeJournal(llm, model, journal, items);

    drafts.push({
      journal,
      category: categoryForSourceLabel(journal),
      title: journalTitle(journal, now),
      body: buildJournalBody(analysis, items, summaries, details),
    });
    if (analysis.trim().length > 0) analysed.push({ journal, analysis });
  }

  // Synthèse transversale en tête (optionnelle, nécessite ≥2 analyses).
  if (deps.synthesis && analysed.length >= 2) {
    const synthesis = await buildGlobalSynthesis(llm, model, analysed);
    if (synthesis !== null) {
      drafts.unshift({
        journal: 'Synthèse',
        category: 'misc',
        title: globalTitle(now),
        body: buildGlobalBody(
          synthesis,
          analysed.map(a => a.journal),
        ),
      });
    }
  }

  log.info('Press dailies built', {
    journals: drafts.length,
    requested: ids.length,
    synthesis: deps.synthesis,
  });
  return drafts;
}
