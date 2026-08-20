import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillStore, parseFrontmatter } from './SkillStore';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skills-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSkill(sub: string, file: string, content: string): void {
  const full = join(dir, sub);
  mkdirSync(full, { recursive: true });
  writeFileSync(join(full, file), content, 'utf-8');
}

const VALID = `---
name: revue-presse
description: Comment répondre à une question portant sur plusieurs journaux.
---

# Revue de presse

1. \`search_dailies\`
2. Cite le journal et la date.
`;

describe('parseFrontmatter', () => {
  it('sépare les métadonnées du corps', () => {
    const { meta, body } = parseFrontmatter(VALID);
    expect(meta['name']).toBe('revue-presse');
    expect(meta['description']).toBe(
      'Comment répondre à une question portant sur plusieurs journaux.',
    );
    expect(body.startsWith('# Revue de presse')).toBe(true);
    expect(body).not.toContain('---');
  });

  it('déquote les valeurs et normalise les clés en minuscules', () => {
    const { meta } = parseFrontmatter('---\nName: "x"\nDESCRIPTION: \'y\'\n---\ncorps');
    expect(meta['name']).toBe('x');
    expect(meta['description']).toBe('y');
  });

  it('gère les fins de ligne Windows (CRLF)', () => {
    const { meta, body } = parseFrontmatter('---\r\nname: a\r\n---\r\ncorps\r\n');
    expect(meta['name']).toBe('a');
    expect(body).toBe('corps');
  });

  it('sans frontmatter, tout est du corps', () => {
    const { meta, body } = parseFrontmatter('# Juste du markdown');
    expect(meta).toEqual({});
    expect(body).toBe('# Juste du markdown');
  });

  it('frontmatter non refermé : ne mange pas le fichier', () => {
    const { meta, body } = parseFrontmatter('---\nname: a\ncorps sans fermeture');
    expect(meta).toEqual({});
    expect(body).toContain('corps sans fermeture');
  });
});

describe('SkillStore.index', () => {
  it('renvoie une liste vide si aucun dossier de skills', () => {
    expect(new SkillStore(dir).index()).toEqual([]);
  });

  it('indexe les skills validés (nom + description, sans le corps)', () => {
    writeSkill('skills', 'revue-presse.md', VALID);
    const [entry, ...rest] = new SkillStore(dir).index();
    expect(rest).toHaveLength(0);
    expect(entry).toEqual({
      name: 'revue-presse',
      description: 'Comment répondre à une question portant sur plusieurs journaux.',
      draft: false,
    });
    expect(JSON.stringify(entry)).not.toContain('search_dailies');
  });

  it("n'indexe JAMAIS les brouillons (garde-fou §8 : rien ne s'applique tout seul)", () => {
    writeSkill('skill-drafts', 'auto-recherche.md', '---\nname: auto-recherche\n---\ncorps');
    expect(new SkillStore(dir).index()).toEqual([]);
  });

  it('un status: draft posé dans skills/ reste un brouillon (le statut prime sur le dossier)', () => {
    writeSkill('skills', 'tricheur.md', '---\nname: tricheur\nstatus: draft\n---\ncorps');
    expect(new SkillStore(dir).index()).toEqual([]);
  });

  it('replie sur le nom de fichier et une description par défaut', () => {
    writeSkill('skills', 'sans-entete.md', '# Pas de frontmatter');
    const [entry] = new SkillStore(dir).index();
    expect(entry?.name).toBe('sans-entete');
    expect(entry?.description).toContain('sans-entete');
  });

  it('borne les descriptions trop longues (payées à chaque tour)', () => {
    writeSkill('skills', 'bavard.md', `---\nname: bavard\ndescription: ${'x'.repeat(500)}\n---\nc`);
    const [entry] = new SkillStore(dir).index();
    expect(entry!.description.length).toBeLessThanOrEqual(201);
    expect(entry!.description.endsWith('…')).toBe(true);
  });

  it('ignore les fichiers non-markdown et trie par nom', () => {
    writeSkill('skills', 'zebre.md', '---\nname: zebre\ndescription: z\n---\nc');
    writeSkill('skills', 'alpha.md', '---\nname: alpha\ndescription: a\n---\nc');
    writeSkill('skills', 'notes.txt', 'ignoré');
    expect(new SkillStore(dir).index().map(s => s.name)).toEqual(['alpha', 'zebre']);
  });
});

describe('SkillStore.load', () => {
  it('renvoie le corps complet du skill validé', () => {
    writeSkill('skills', 'revue-presse.md', VALID);
    const skill = new SkillStore(dir).load('revue-presse');
    expect(skill?.body).toContain('search_dailies');
    expect(skill?.draft).toBe(false);
  });

  it('est insensible à la casse et aux espaces', () => {
    writeSkill('skills', 'revue-presse.md', VALID);
    expect(new SkillStore(dir).load('  REVUE-Presse ')?.name).toBe('revue-presse');
  });

  it('charge un brouillon nommé explicitement, en le marquant draft', () => {
    writeSkill('skill-drafts', 'auto-x.md', '---\nname: auto-x\n---\nprocédure');
    const skill = new SkillStore(dir).load('auto-x');
    expect(skill?.body).toBe('procédure');
    expect(skill?.draft).toBe(true);
  });

  it('renvoie null pour un nom inconnu ou vide', () => {
    writeSkill('skills', 'revue-presse.md', VALID);
    const store = new SkillStore(dir);
    expect(store.load('inexistant')).toBeNull();
    expect(store.load('   ')).toBeNull();
  });
});

describe('SkillStore — skills embarqués avec l’app', () => {
  let bundled: string;

  beforeEach(() => {
    bundled = mkdtempSync(join(tmpdir(), 'skills-bundled-'));
  });

  afterEach(() => {
    rmSync(bundled, { recursive: true, force: true });
  });

  function writeBundled(file: string, content: string): void {
    writeFileSync(join(bundled, file), content, 'utf-8');
  }

  it('indexe les skills embarqués quand l’utilisateur n’en a aucun', () => {
    writeBundled('revue.md', '---\nname: revue\ndescription: livrée\n---\ncorps livré');
    const store = new SkillStore(dir, bundled);

    expect(store.index().map(s => s.name)).toEqual(['revue']);
    expect(store.load('revue')?.body).toBe('corps livré');
  });

  it('un skill utilisateur PRIME sur l’embarqué de même nom', () => {
    writeBundled('revue.md', '---\nname: revue\ndescription: livrée\n---\ncorps livré');
    writeSkill('skills', 'revue.md', '---\nname: revue\ndescription: perso\n---\ncorps perso');
    const store = new SkillStore(dir, bundled);

    // Sans quoi une mise à jour de l'app écraserait la personnalisation.
    expect(store.index()).toEqual([{ name: 'revue', description: 'perso', draft: false }]);
    expect(store.load('revue')?.body).toBe('corps perso');
  });

  it('fusionne les deux sources sans doublon, triées', () => {
    writeBundled('b-livre.md', '---\nname: b-livre\ndescription: x\n---\nc');
    writeSkill('skills', 'a-perso.md', '---\nname: a-perso\ndescription: y\n---\nc');
    expect(new SkillStore(dir, bundled).index().map(s => s.name)).toEqual(['a-perso', 'b-livre']);
  });

  it('un dossier embarqué absent ou non fourni reste sans effet', () => {
    writeSkill('skills', 'perso.md', '---\nname: perso\ndescription: y\n---\nc');
    expect(new SkillStore(dir).index().map(s => s.name)).toEqual(['perso']);
    expect(
      new SkillStore(dir, join(tmpdir(), 'catdesk-absent-xyz')).index().map(s => s.name),
    ).toEqual(['perso']);
  });
});

describe('SkillStore.pendingDrafts', () => {
  it('liste les brouillons des deux dossiers, triés', () => {
    writeSkill('skill-drafts', 'auto-b.md', '---\nname: auto-b\n---\nc');
    writeSkill('skills', 'auto-a.md', '---\nname: auto-a\nstatus: draft\n---\nc');
    writeSkill('skills', 'valide.md', VALID);
    expect(new SkillStore(dir).pendingDrafts()).toEqual(['auto-a', 'auto-b']);
  });
});
