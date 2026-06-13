import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, basename, extname } from 'path';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface ObsidianNotesArgs {
  vault?: string;
  query?: string;
  note?: string;
  tag?: string;
  limit?: number;
}

interface ParsedNote {
  frontmatter: Record<string, string>;
  tags: string[];
  links: string[];
  body: string;
}

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

// ─── Note parsing (pure, exported for tests) ───────────────────

export function parseNote(content: string): ParsedNote {
  const frontmatter: Record<string, string> = {};
  let body = content;

  // YAML frontmatter between leading --- ... ---
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    body = content.slice(fm[0].length);
    for (const line of (fm[1] ?? '').split('\n')) {
      const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (kv) frontmatter[kv[1] ?? ''] = (kv[2] ?? '').trim();
    }
  }

  const tags = new Set<string>();
  // Frontmatter tags: "tags: a, b" or "[a, b]"
  const fmTags = frontmatter['tags'];
  if (fmTags) {
    for (const t of fmTags.replace(/[[\]]/g, '').split(/[,\s]+/)) {
      const clean = t.replace(/^#/, '').trim();
      if (clean) tags.add(clean);
    }
  }
  // Inline #tags in the body (skip code spans roughly by ignoring lines starting with ```)
  for (const m of body.matchAll(/(?:^|\s)#([A-Za-z0-9][\w/-]*)/g)) {
    if (m[1]) tags.add(m[1]);
  }

  // [[wiki links]] (strip alias after |)
  const links = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
    const name = m[1]?.trim();
    if (name) links.add(name);
  }

  return { frontmatter, tags: [...tags], links: [...links], body };
}

// ─── Vault walking ─────────────────────────────────────────────

async function walkMarkdown(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await recurse(join(dir, e.name));
      } else if (e.isFile() && extname(e.name).toLowerCase() === '.md') {
        out.push(join(dir, e.name));
      }
    }
  }
  await recurse(root);
  return out;
}

// ─── Search scoring (pure, exported for tests) ─────────────────

export interface NoteDoc {
  path: string;   // relative path for display
  title: string;
  content: string;
}

export interface SearchHit {
  path: string;
  title: string;
  score: number;
  snippet: string;
  tags: string[];
}

export function searchNotes(docs: NoteDoc[], query: string, tag: string | undefined, limit: number): SearchHit[] {
  const q = query.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const hits: SearchHit[] = [];

  for (const doc of docs) {
    const parsed = parseNote(doc.content);

    if (tag !== undefined && tag.length > 0) {
      const want = tag.replace(/^#/, '').toLowerCase();
      if (!parsed.tags.some((t) => t.toLowerCase() === want)) continue;
    }

    const titleLower = doc.title.toLowerCase();
    const bodyLower = parsed.body.toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (titleLower.includes(term)) score += 10;
      const occurrences = bodyLower.split(term).length - 1;
      score += Math.min(occurrences, 5);
    }
    // With no query but a tag filter, every tagged note qualifies.
    if (terms.length === 0 && tag !== undefined) score = 1;

    if (score <= 0) continue;

    // Snippet around the first matching term.
    let snippet = parsed.body.slice(0, 160).replace(/\s+/g, ' ').trim();
    const firstTerm = terms[0];
    if (firstTerm) {
      const idx = bodyLower.indexOf(firstTerm);
      if (idx >= 0) {
        const start = Math.max(0, idx - 60);
        snippet = (start > 0 ? '…' : '') + parsed.body.slice(start, idx + 100).replace(/\s+/g, ' ').trim() + '…';
      }
    }

    hits.push({ path: doc.path, title: doc.title, score, snippet, tags: parsed.tags });
  }

  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, Math.max(1, limit));
}

// ─── Tool ──────────────────────────────────────────────────────

export class ObsidianNotesTool extends BaseTool {
  readonly name = 'obsidian_notes';
  readonly description =
    "Recherche et lit les notes d'un coffre Obsidian local (markdown). Sans réseau : parcourt les fichiers .md, parse frontmatter/tags/liens [[wiki]]. Donne `note` pour lire une note entière, sinon `query`/`tag` pour chercher.";
  readonly category = 'filesystem' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.obsidian_notes;

  async execute(args: unknown): Promise<ToolResult> {
    const { vault, query, note, tag, limit = 15 } = args as ObsidianNotesArgs;
    const root = vault ?? process.env['OBSIDIAN_VAULT'] ?? '';

    if (root.length === 0) {
      return this.fail('Coffre Obsidian non spécifié. Passe `vault` ou définis OBSIDIAN_VAULT.');
    }
    try {
      const s = await stat(root);
      if (!s.isDirectory()) return this.fail(`Le chemin du coffre n'est pas un dossier: ${root}`);
    } catch {
      return this.fail(`Coffre introuvable: ${root}`);
    }

    const files = await walkMarkdown(root);
    if (files.length === 0) {
      return this.ok({ vault: root, noteCount: 0, summary: 'Aucune note markdown dans ce coffre.' });
    }

    // ── Read a specific note ──
    if (typeof note === 'string' && note.length > 0) {
      const wanted = note.toLowerCase().replace(/\.md$/, '');
      const match = files.find((f) => {
        const rel = relative(root, f).replace(/\\/g, '/').toLowerCase();
        const title = basename(f, '.md').toLowerCase();
        return rel === `${wanted}.md` || rel === wanted || title === wanted;
      });
      if (match === undefined) {
        return this.fail(`Note introuvable: "${note}". Cherche d'abord avec query pour trouver le bon titre.`);
      }
      const content = await readFile(match, 'utf-8');
      const parsed = parseNote(content);
      return this.ok({
        vault: root,
        note: relative(root, match).replace(/\\/g, '/'),
        title: basename(match, '.md'),
        frontmatter: parsed.frontmatter,
        tags: parsed.tags,
        outgoingLinks: parsed.links,
        content: content.slice(0, 20000),
        truncated: content.length > 20000,
      });
    }

    // ── Search ──
    if ((typeof query !== 'string' || query.trim().length === 0) && (typeof tag !== 'string' || tag.length === 0)) {
      return this.fail('Fournis `query` (texte à chercher), `tag`, ou `note` (lecture d\'une note).');
    }

    const docs: NoteDoc[] = [];
    for (const f of files) {
      try {
        const content = await readFile(f, 'utf-8');
        docs.push({ path: relative(root, f).replace(/\\/g, '/'), title: basename(f, '.md'), content });
      } catch {
        // skip unreadable files
      }
    }

    const hits = searchNotes(docs, query ?? '', tag, limit);
    return this.ok({
      vault: root,
      ...(query ? { query } : {}),
      ...(tag ? { tag } : {}),
      noteCount: files.length,
      matchCount: hits.length,
      results: hits,
      note: 'Utilise `note: "<titre>"` pour lire une note entière à partir d\'un résultat.',
    });
  }
}
