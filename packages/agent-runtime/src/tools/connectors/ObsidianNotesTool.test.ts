import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ObsidianNotesTool, parseNote, searchNotes, type NoteDoc } from './ObsidianNotesTool';

describe('parseNote', () => {
  it('extrait frontmatter, tags et liens', () => {
    const content = `---
title: My Note
tags: project, rust
---
Hello #world and #rust/async.
See [[Other Note]] and [[Third|alias]].`;
    const p = parseNote(content);
    expect(p.frontmatter['title']).toBe('My Note');
    expect(p.tags).toEqual(expect.arrayContaining(['project', 'rust', 'world', 'rust/async']));
    expect(p.links).toEqual(expect.arrayContaining(['Other Note', 'Third']));
    expect(p.body).not.toContain('title: My Note');
  });
});

describe('searchNotes', () => {
  const docs: NoteDoc[] = [
    {
      path: 'a.md',
      title: 'Rust tips',
      content: '---\ntags: rust\n---\nBorrow checker and lifetimes.',
    },
    { path: 'b.md', title: 'Cooking', content: 'How to make pasta. Nothing technical here.' },
    { path: 'c.md', title: 'Async', content: '#rust async await tokio runtime.' },
  ];

  it('classe par pertinence (titre pèse plus)', () => {
    const hits = searchNotes(docs, 'rust', undefined, 10);
    expect(hits[0]?.title).toBe('Rust tips');
    expect(hits.map(h => h.path)).not.toContain('b.md');
  });

  it('filtre par tag', () => {
    const hits = searchNotes(docs, '', 'rust', 10);
    const paths = hits.map(h => h.path).sort();
    expect(paths).toEqual(['a.md', 'c.md']);
  });

  it('respecte la limite', () => {
    expect(searchNotes(docs, 'rust async pasta', undefined, 1)).toHaveLength(1);
  });
});

describe('ObsidianNotesTool (vault réel)', () => {
  const tool = new ObsidianNotesTool();
  let vault = '';

  beforeAll(async () => {
    vault = await mkdtemp(join(tmpdir(), 'ndvault-'));
    await mkdir(join(vault, '.obsidian'), { recursive: true });
    await writeFile(join(vault, '.obsidian', 'app.json'), '{}'); // must be ignored
    await mkdir(join(vault, 'sub'), { recursive: true });
    await writeFile(
      join(vault, 'Welcome.md'),
      '---\ntags: intro\n---\nWelcome to the vault. [[Welcome]]',
    );
    await writeFile(join(vault, 'sub', 'Deep.md'), 'Some deep note about tokio runtime.');
  });

  afterAll(async () => {
    if (vault) await rm(vault, { recursive: true, force: true });
  });

  it('échoue sans coffre', async () => {
    const res = await tool.run({ query: 'x' });
    expect(res.success).toBe(false);
  });

  it('cherche dans les sous-dossiers et ignore .obsidian', async () => {
    const res: any = await tool.run({ vault, query: 'tokio' });
    expect(res.success).toBe(true);
    expect(res.data.noteCount).toBe(2); // app.json not counted
    expect(res.data.results[0].path).toBe('sub/Deep.md');
  });

  it('lit une note entière par titre', async () => {
    const res: any = await tool.run({ vault, note: 'Welcome' });
    expect(res.success).toBe(true);
    expect(res.data.tags).toContain('intro');
    expect(res.data.content).toContain('Welcome to the vault');
  });

  it('retourne une erreur pour une note absente', async () => {
    const res = await tool.run({ vault, note: 'Nope' });
    expect(res.success).toBe(false);
  });
});
