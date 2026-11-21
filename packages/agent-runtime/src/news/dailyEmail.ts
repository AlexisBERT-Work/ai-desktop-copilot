import type { Daily, PressFeed } from '@catdesk/shared-types';
import { maskEmail, type EmailMessage, type SendEmailResult } from '../lib/email';
import type { JournalDraft } from './pressDigest';
import { createLogger } from '../logger';

const log = createLogger('news:daily-email');

// ─── Mise en forme ─────────────────────────────────────────────
// Conversion CIBLÉE du Markdown produit par `buildJournalBody` (pressDigest.ts) :
// paragraphes d'analyse, puces `- [titre](url) — résumé`, détail `  > …`,
// gras/italique. Pas de bibliothèque Markdown : le format d'entrée est connu,
// et tout le texte (issu de flux RSS tiers et du LLM) est échappé.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CODE_STYLE =
  'font-family:Consolas,Menlo,monospace;font-size:.92em;background:#f4f4f5;padding:0 3px;border-radius:3px';

/** Code `x`, gras `**x**` et italique `*x*` sur un texte DÉJÀ échappé. */
function emphasis(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, `<code style="${CODE_STYLE}">$1</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>');
}

const LINK_STYLE = 'color:#2563eb;font-weight:600;text-decoration:none';

/**
 * Texte en ligne → HTML : liens `[texte](url)` (http/https seulement — un
 * `javascript:` reste du texte), emphase ailleurs, tout échappé. Pur, exporté
 * pour tests.
 */
export function inlineHtml(text: string): string {
  const link = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(link)) {
    const [whole, label = '', url = ''] = m;
    const start = m.index ?? 0;
    out += emphasis(escapeHtml(text.slice(last, start)));
    out += /^https?:\/\//i.test(url)
      ? `<a href="${escapeHtml(url)}" style="${LINK_STYLE}">${escapeHtml(label)}</a>`
      : escapeHtml(whole);
    last = start + whole.length;
  }
  return out + emphasis(escapeHtml(text.slice(last)));
}

const DETAIL_STYLE =
  'margin:4px 0 0;padding-left:10px;border-left:3px solid #e4e4e7;color:#52525b;font-size:13px';

/** Corps Markdown d'une daily → HTML (styles en ligne, pour les clients mail). Pur, exporté pour tests. */
export function dailyBodyHtml(markdown: string): string {
  const parts: string[] = [];
  for (const block of markdown.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) continue;

    if (lines[0]!.startsWith('- ')) {
      const items: { head: string; details: string[] }[] = [];
      for (const line of lines) {
        const detail = /^\s*>\s?(.*)$/.exec(line);
        const current = items[items.length - 1];
        if (detail && current) current.details.push(detail[1] ?? '');
        else items.push({ head: line.replace(/^-\s+/, ''), details: [] });
      }
      const lis = items.map(
        it =>
          `<li style="margin:0 0 10px">${inlineHtml(it.head)}${it.details
            .map(d => `<div style="${DETAIL_STYLE}">${inlineHtml(d)}</div>`)
            .join('')}</li>`,
      );
      parts.push(`<ul style="margin:0 0 12px;padding-left:20px">${lis.join('')}</ul>`);
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(lines[0]!);
    if (heading && lines.length === 1) {
      parts.push(
        `<h3 style="font-size:15px;margin:16px 0 8px">${inlineHtml(heading[1] ?? '')}</h3>`,
      );
      continue;
    }
    parts.push(`<p style="margin:0 0 12px">${lines.map(inlineHtml).join('<br>')}</p>`);
  }
  return parts.join('\n');
}

const FOOTER =
  "Rédigé localement par CatDesk à partir de flux RSS publics. Les résumés sont générés par IA : vérifie dans l'article d'origine avant de citer.";

/** Sujet : le titre de la daily s'il n'y en a qu'une, sinon un récapitulatif daté. Pur. */
export function emailSubject(dailies: Pick<Daily, 'title'>[], now = new Date()): string {
  if (dailies.length === 1) return dailies[0]!.title;
  const date = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `CatDesk — ${dailies.length} revues du ${date}`;
}

/** Un message pour un destinataire : toutes ses dailys du run, texte + HTML. Pur, exporté pour tests. */
export function renderDailyEmail(
  dailies: Pick<Daily, 'title' | 'body'>[],
  now = new Date(),
): Omit<EmailMessage, 'to'> {
  const text = [
    ...dailies.map(d => `${d.title}\n${'='.repeat(Math.min(d.title.length, 60))}\n\n${d.body}`),
    `--\n${FOOTER}`,
  ].join('\n\n');

  const cards = dailies
    .map(
      d =>
        `<div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:20px;margin:0 0 16px">` +
        `<h2 style="font-size:18px;line-height:1.3;margin:0 0 12px">${escapeHtml(d.title)}</h2>` +
        dailyBodyHtml(d.body) +
        `</div>`,
    )
    .join('\n');

  const html =
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head>` +
    `<body style="margin:0;padding:0;background:#f4f4f5">` +
    `<div style="max-width:680px;margin:0 auto;padding:24px 16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#18181b">` +
    cards +
    `<p style="font-size:11px;color:#a1a1aa;margin:8px 0 0">${escapeHtml(FOOTER)}</p>` +
    `</div></body></html>`;

  return { subject: emailSubject(dailies, now), text, html };
}

// ─── Destinataires et envoi ────────────────────────────────────

/**
 * Regroupe les dailys d'un run par destinataire. Une daily est reliée à son
 * journal par son titre (→ `draft.journal` → `feed.name`) : la même clé que la
 * déduplication par titre de LocalDailyStore. Pur, exporté pour tests.
 */
export function groupByRecipient(
  changed: Daily[],
  drafts: JournalDraft[],
  feeds: PressFeed[],
): Map<string, Daily[]> {
  const journalByTitle = new Map(drafts.map(d => [d.title, d.journal]));
  const recipientByJournal = new Map(
    feeds.filter(f => f.emailTo !== null).map(f => [f.name, f.emailTo as string]),
  );
  const out = new Map<string, Daily[]>();
  for (const daily of changed) {
    const journal = journalByTitle.get(daily.title);
    const to = journal === undefined ? undefined : recipientByJournal.get(journal);
    if (to === undefined) continue;
    out.set(to, [...(out.get(to) ?? []), daily]);
  }
  return out;
}

/** Envoi d'un message : `sendConfiguredEmail` en production, un faux en test. */
export type DailyMailer = (msg: EmailMessage) => Promise<SendEmailResult>;

export interface DailyEmailOutcome {
  /** Messages envoyés avec succès. */
  emailed: number;
  /** Première erreur d'envoi, s'il y en a eu. */
  error?: string;
}

/**
 * Envoie les dailys produites par un run aux destinataires de leurs journaux :
 * un message par destinataire. Best-effort : un échec n'arrête pas les autres
 * envois et ne remet jamais en cause les dailys déjà enregistrées.
 */
export async function emailChangedDailies(
  changed: Daily[],
  drafts: JournalDraft[],
  feeds: PressFeed[],
  mailer: DailyMailer,
  now = new Date(),
): Promise<DailyEmailOutcome> {
  let emailed = 0;
  let error: string | undefined;
  for (const [to, dailies] of groupByRecipient(changed, drafts, feeds)) {
    const res = await mailer({ to, ...renderDailyEmail(dailies, now) });
    if (res.ok) {
      emailed += 1;
      log.info('Dailys envoyées par e-mail', { to: maskEmail(to), dailies: dailies.length });
    } else {
      error ??= res.error;
      log.warn('Envoi des dailys par e-mail échoué', { to: maskEmail(to), error: res.error });
    }
  }
  return error === undefined ? { emailed } : { emailed, error };
}
