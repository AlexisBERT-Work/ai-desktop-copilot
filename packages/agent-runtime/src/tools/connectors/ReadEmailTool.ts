import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface ReadEmailArgs {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  mailbox?: string;
  limit?: number;
  unseen_only?: boolean;
  since?: string;
  search?: string;
  fetch_uid?: number;
}

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  mailbox: string;
}

type EnvLike = Record<string, string | undefined>;

/** Resolve IMAP connection settings from args, falling back to env. Pure. */
export function resolveImapConfig(
  args: ReadEmailArgs,
  env: EnvLike,
): { ok: true; config: ImapConfig } | { ok: false; error: string } {
  const host = args.host ?? env['IMAP_HOST'];
  const user = args.user ?? env['IMAP_USER'];
  const pass = args.password ?? env['IMAP_PASSWORD'];
  if (!host) return { ok: false, error: 'host requis (ou variable IMAP_HOST).' };
  if (!user) return { ok: false, error: 'user requis (ou variable IMAP_USER).' };
  if (!pass) return { ok: false, error: 'password requis (ou variable IMAP_PASSWORD).' };

  const port = args.port ?? (Number(env['IMAP_PORT']) || 993);
  const secure = args.secure ?? port !== 143;
  return { ok: true, config: { host, port, secure, user, pass, mailbox: args.mailbox ?? 'INBOX' } };
}

/** Build imapflow search criteria from filters, or null for "recent by sequence". Pure. */
export function buildSearchCriteria(args: ReadEmailArgs): Record<string, unknown> | null {
  const criteria: Record<string, unknown> = {};
  if (args.unseen_only) criteria['seen'] = false;
  if (args.since) {
    const d = new Date(args.since);
    if (!Number.isNaN(d.getTime())) criteria['since'] = d;
  }
  if (args.search?.trim()) {
    const t = args.search.trim();
    criteria['or'] = [{ subject: t }, { from: t }];
  }
  return Object.keys(criteria).length > 0 ? criteria : null;
}

interface Addr {
  name?: string;
  address?: string;
}

function formatAddrs(list: Addr[] | undefined): string {
  if (!list || list.length === 0) return '';
  return list
    .map((a) => (a.name ? `${a.name} <${a.address ?? ''}>` : a.address ?? ''))
    .filter(Boolean)
    .join(', ');
}

/**
 * Read email over IMAP (read-only). Two modes:
 * - list (default): recent messages from a mailbox (envelope + flags), with
 *   optional unseen-only / since / search filters.
 * - single message: pass fetch_uid to download and parse one message's text.
 * Outward-facing network connector with credentials — high risk, confirmation.
 */
export class ReadEmailTool extends BaseTool {
  readonly name = 'read_email';
  readonly description =
    "Lit une boîte mail en IMAP (lecture seule). Sans fetch_uid : liste les messages récents d'une boîte (expéditeur, sujet, date, lu/non-lu), filtres unseen_only/since/search. Avec fetch_uid : télécharge et extrait le texte d'un message. Connexion via host/user/password ou variables IMAP_HOST/IMAP_USER/IMAP_PASSWORD. Connecteur réseau sortant avec identifiants.";
  readonly category = 'web' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  readonly schema = TOOL_SCHEMAS.read_email;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as ReadEmailArgs;

    const resolved = resolveImapConfig(args, process.env);
    if (!resolved.ok) return this.fail(resolved.error);
    const cfg = resolved.config;
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);

    let client: import('imapflow').ImapFlow;
    try {
      const { ImapFlow } = await import('imapflow');
      client = new ImapFlow({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: cfg.user, pass: cfg.pass },
        logger: false,
      });
      await client.connect();
    } catch (err) {
      return this.fail(this.explain(err));
    }

    try {
      const lock = await client.getMailboxLock(cfg.mailbox);
      try {
        return args.fetch_uid !== undefined
          ? await this.readOne(client, cfg, args.fetch_uid)
          : await this.list(client, cfg, args, limit);
      } finally {
        lock.release();
      }
    } catch (err) {
      return this.fail(this.explain(err));
    } finally {
      try {
        await client.logout();
      } catch {
        /* best-effort */
      }
    }
  }

  private async list(
    client: import('imapflow').ImapFlow,
    cfg: ImapConfig,
    args: ReadEmailArgs,
    limit: number,
  ): Promise<ToolResult> {
    const criteria = buildSearchCriteria(args);
    const messages: Array<Record<string, unknown>> = [];
    const query = { envelope: true, flags: true } as const;

    if (criteria) {
      const uids = (await client.search(criteria, { uid: true })) || [];
      const pick = uids.slice(-limit);
      if (pick.length > 0) {
        for await (const msg of client.fetch(pick, query, { uid: true })) {
          messages.push(this.summary(msg));
        }
      }
    } else {
      const mb = client.mailbox;
      const total = typeof mb === 'object' && mb ? mb.exists : 0;
      if (total > 0) {
        const start = Math.max(1, total - limit + 1);
        for await (const msg of client.fetch(`${start}:${total}`, query)) {
          messages.push(this.summary(msg));
        }
      }
    }

    messages.sort((a, b) => String(b['date'] ?? '').localeCompare(String(a['date'] ?? '')));
    return this.ok({
      mailbox: cfg.mailbox,
      count: messages.length,
      messages: messages.slice(0, limit),
    });
  }

  private summary(msg: import('imapflow').FetchMessageObject): Record<string, unknown> {
    const env = msg.envelope;
    const date = env?.date instanceof Date ? env.date.toISOString() : null;
    return {
      uid: msg.uid,
      from: formatAddrs(env?.from),
      to: formatAddrs(env?.to),
      subject: env?.subject ?? '',
      date,
      seen: msg.flags ? msg.flags.has('\\Seen') : false,
    };
  }

  private async readOne(
    client: import('imapflow').ImapFlow,
    cfg: ImapConfig,
    uid: number,
  ): Promise<ToolResult> {
    const msg = await client.fetchOne(String(uid), { uid: true, source: true, envelope: true }, { uid: true });
    if (!msg || !msg.source) return this.fail(`Message introuvable : uid ${uid} dans ${cfg.mailbox}.`);

    const { simpleParser } = await import('mailparser');
    const parsed = await simpleParser(msg.source);
    const text = (parsed.text ?? '').trim();
    return this.ok({
      uid,
      mailbox: cfg.mailbox,
      from: parsed.from?.text ?? '',
      subject: parsed.subject ?? '',
      date: parsed.date ? parsed.date.toISOString() : null,
      text: text.length > 20_000 ? text.slice(0, 20_000) + '…' : text,
      truncated: text.length > 20_000,
    });
  }

  private explain(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Cannot find module|ERR_MODULE_NOT_FOUND/i.test(msg)) {
      return 'Driver IMAP manquant. Installe : pnpm --filter @catdesk/agent-runtime add imapflow mailparser';
    }
    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(msg)) {
      return `Connexion au serveur IMAP impossible : ${msg}`;
    }
    if (/auth|credentials|LOGIN failed|AUTHENTICATE/i.test(msg)) {
      return `Authentification IMAP refusée : ${msg}`;
    }
    return `Erreur IMAP : ${msg}`;
  }
}
