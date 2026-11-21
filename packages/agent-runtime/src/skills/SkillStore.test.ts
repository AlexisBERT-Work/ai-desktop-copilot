import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { renderSkillDraft } from '../playbook/proposeSkills';
import { SkillStore, parseFrontmatter } from './SkillStore';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skills-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relativePath: string, content: string, root = dir): void {
  const full = join(root, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

/** Un lien vers un fichier demande un droit spécial sous Windows, pas une jonction. */
const canLinkFiles = ((): boolean => {
  const probe = mkdtempSync(join(tmpdir(), 'skills-probe-'));
  try {
    writeFileSync(join(probe, 'cible'), '');
    symlinkSync(join(probe, 'cible'), join(probe, 'lien'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

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
    const { meta } = parseFrontmatter(
      `---\nName: "x: y"\nDESCRIPTION: 'l''agent'\nautre: "non refermé\n---\ncorps`,
    );
    expect(meta['name']).toBe('x: y');
    expect(meta['description']).toBe("l'agent");
    expect(meta['autre']).toBe('"non refermé');
  });

  it('gère les fins de ligne Windows et le BOM', () => {
    const { meta, body } = parseFrontmatter('\uFEFF---\r\nname: a\r\n---\r\ncorps\r\n');
    expect(meta['name']).toBe('a');
    expect(body).toBe('corps');
  });

  it('lit une description sur plusieurs lignes, comme dans les dépôts de skills', () => {
    const folded = parseFrontmatter(
      '---\nname: a\ndescription: >-\n  Première ligne\n  et seconde.\nlicense: MIT\n---\nc',
    );
    expect(folded.meta['description']).toBe('Première ligne et seconde.');
    expect(folded.meta['license']).toBe('MIT');

    const plain = parseFrontmatter('---\ndescription: Début\n  et suite\n\nname: a\n---\nc');
    expect(plain.meta['description']).toBe('Début et suite');
    expect(plain.meta['name']).toBe('a');
  });

  it('une clé imbriquée ne devient pas une clé de premier niveau', () => {
    const { meta } = parseFrontmatter(
      '---\nname: a\nmetadata:\n  status: draft\n  name: pirate\n---\ncorps',
    );
    expect(meta['name']).toBe('a');
    expect(meta['status']).toBeUndefined();
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

describe('format SKILL.md', () => {
  it('lit la disposition standard <nom>/SKILL.md', () => {
    write('skills/revue-presse/SKILL.md', VALID);
    expect(new SkillStore(dir).load('revue-presse')?.body).toContain('search_dailies');
  });

  it('lit aussi un simple <nom>.md', () => {
    write('skills/revue-presse.md', VALID);
    expect(new SkillStore(dir).load('revue-presse')?.body).toContain('search_dailies');
  });

  it('sans name, reprend le nom du dossier ou du fichier', () => {
    write('skills/en-dossier/SKILL.md', '---\ndescription: d\n---\nc');
    write('skills/en-fichier.md', '---\ndescription: d\n---\nc');
    expect(
      new SkillStore(dir)
        .catalog()
        .map(s => s.name)
        .sort(),
    ).toEqual(['en-dossier', 'en-fichier']);
  });

  it('ne lit que le SKILL.md : ni les scripts ni les références voisines', () => {
    write('skills/outil/SKILL.md', '---\nname: outil\ndescription: d\n---\ncorps');
    write('skills/outil/scripts/install.ps1', 'Remove-Item -Recurse C:\\');
    write('skills/outil/references/notes.md', '---\nname: notes\ndescription: d\n---\nc');

    const store = new SkillStore(dir);
    expect(store.load('outil')?.body).toBe('corps');
    expect(store.catalog().map(s => s.name)).toEqual(['outil']);
    expect(store.load('notes')).toBeNull();
  });

  it("ignore un fichier sans description : un README n'est pas un skill", () => {
    write('skills/README.md', '# Mes skills');
    write('skills/sans-description.md', '---\nname: x\n---\ncorps');
    expect(new SkillStore(dir).catalog()).toEqual([]);
  });

  it('ignore un skill au corps vide, au nom vide de sens ou trop long', () => {
    write('skills/vide.md', '---\nname: vide\ndescription: d\n---\n');
    write('skills/symboles.md', '---\nname: "..."\ndescription: d\n---\nc');
    write('skills/long.md', `---\nname: ${'x'.repeat(65)}\ndescription: d\n---\nc`);
    expect(new SkillStore(dir).catalog()).toEqual([]);
  });

  it('ignore un fichier démesuré, sans perdre les autres', () => {
    write('skills/enorme.md', `---\nname: enorme\ndescription: d\n---\n${'x'.repeat(200_000)}`);
    write('skills/revue-presse.md', VALID);
    expect(
      new SkillStore(dir)
        .catalog()
        .map(s => s.name)
        .sort(),
    ).toEqual(['revue-presse']);
  });
});

describe('SkillStore.catalog', () => {
  it('renvoie une liste vide si aucun dossier de skills', () => {
    expect(new SkillStore(dir).catalog()).toEqual([]);
  });

  it('donne le nom, la description et la source, jamais le corps', () => {
    write('skills/revue-presse.md', VALID);
    const [entry, ...rest] = new SkillStore(dir).catalog();
    expect(rest).toHaveLength(0);
    expect(entry).toEqual({
      name: 'revue-presse',
      description: 'Comment répondre à une question portant sur plusieurs journaux.',
      source: 'user',
    });
  });

  it("n'annonce JAMAIS un brouillon (garde-fou §8 : rien ne s'applique tout seul)", () => {
    write('skill-drafts/auto-recherche.md', '---\nname: auto-recherche\ndescription: d\n---\nc');
    expect(new SkillStore(dir).catalog()).toEqual([]);
  });

  it('un status: draft posé dans skills/ reste un brouillon', () => {
    write('skills/tricheur.md', '---\nname: tricheur\ndescription: d\nstatus: draft\n---\nc');
    expect(new SkillStore(dir).catalog()).toEqual([]);
  });

  it('borne les descriptions trop longues', () => {
    write('skills/bavard.md', `---\nname: bavard\ndescription: ${'x'.repeat(500)}\n---\nc`);
    const [entry] = new SkillStore(dir).catalog();
    expect(entry?.description).toHaveLength(201);
    expect(entry?.description.endsWith('…')).toBe(true);
  });

  it('ignore les fichiers non-markdown et trie par nom', () => {
    write('skills/zebre.md', '---\nname: zebre\ndescription: z\n---\nc');
    write('skills/alpha.md', '---\nname: alpha\ndescription: a\n---\nc');
    write('skills/notes.txt', 'ignoré');
    expect(
      new SkillStore(dir)
        .catalog()
        .map(s => s.name)
        .sort(),
    ).toEqual(['alpha', 'zebre']);
  });
});

describe('SkillStore.load', () => {
  it('ne tient compte ni de la casse, ni des accents, ni des espaces', () => {
    write('skills/verifier-source.md', '---\nname: verifier-source\ndescription: d\n---\nc');
    const store = new SkillStore(dir);
    expect(store.load('  VERIFIER-Source ')?.name).toBe('verifier-source');
    expect(store.load('vérifier source')?.name).toBe('verifier-source');
  });

  it('charge un brouillon nommé explicitement, marqué comme tel', () => {
    write('skill-drafts/auto-x.md', '---\nname: auto-x\ndescription: d\n---\nprocédure');
    const skill = new SkillStore(dir).load('auto-x');
    expect(skill?.body).toBe('procédure');
    expect(skill?.source).toBe('draft');
  });

  it("relit ce que proposeSkills écrit : la boucle de l'EvolutionDaemon est fermée", () => {
    const markdown = renderSkillDraft({
      taskType: 'recherche actu',
      approach: 'search_dailies>read_webpage',
      successRate: 0.8,
      attempts: 5,
      slug: 'auto-recherche-actu',
    });
    write('skill-drafts/auto-recherche-actu.md', markdown);

    const store = new SkillStore(dir);
    const skill = store.load('auto-recherche-actu');
    expect(skill?.source).toBe('draft');
    expect(skill?.body).toContain('`read_webpage`');
    expect(store.catalog()).toEqual([]);
  });

  it("un brouillon ne prend pas la place d'un skill validé de même nom", () => {
    write('skills/revue.md', '---\nname: revue\ndescription: d\nstatus: draft\n---\nbrouillon');
    const bundled = join(dir, 'livres');
    write('revue/SKILL.md', '---\nname: revue\ndescription: d\n---\nvalidé', bundled);
    expect(new SkillStore(dir, bundled).load('revue')?.body).toBe('validé');
  });

  it('renvoie null pour un nom inconnu ou vide', () => {
    write('skills/revue-presse.md', VALID);
    const store = new SkillStore(dir);
    expect(store.load('inexistant')).toBeNull();
    expect(store.load('   ')).toBeNull();
    expect(store.load('...')).toBeNull();
  });

  it('un nom n’est jamais un chemin', () => {
    write('secret.md', '---\nname: secret\ndescription: d\n---\nmot de passe');
    write('skills/revue-presse.md', VALID);
    const store = new SkillStore(dir);
    expect(store.load('../secret')).toBeNull();
    expect(store.load('../secret.md')).toBeNull();
    expect(store.load(join(dir, 'secret.md'))).toBeNull();
  });
});

describe('liens hors du dossier', () => {
  it('ne suit pas une jonction vers un dossier extérieur', () => {
    const outside = join(dir, 'dehors');
    write('dehors/SKILL.md', '---\nname: dehors\ndescription: d\n---\nsecret');
    mkdirSync(join(dir, 'skills'));
    symlinkSync(outside, join(dir, 'skills', 'evil'), 'junction');

    expect(new SkillStore(dir).load('dehors')).toBeNull();
    expect(new SkillStore(dir).load('evil')).toBeNull();
  });

  it.skipIf(!canLinkFiles)('ne suit pas un SKILL.md qui pointe hors du dossier', () => {
    write('secret.txt', '---\nname: evil\ndescription: d\n---\nsecret');
    mkdirSync(join(dir, 'skills', 'evil'), { recursive: true });
    symlinkSync(join(dir, 'secret.txt'), join(dir, 'skills', 'evil', 'SKILL.md'), 'file');

    expect(new SkillStore(dir).load('evil')).toBeNull();
  });

  it.skipIf(!canLinkFiles)('garde un lien qui reste dans le dossier', () => {
    write('skills/original/SKILL.md', VALID);
    mkdirSync(join(dir, 'skills', 'alias'));
    symlinkSync(
      join(dir, 'skills', 'original', 'SKILL.md'),
      join(dir, 'skills', 'alias', 'SKILL.md'),
      'file',
    );

    expect(new SkillStore(dir).load('revue-presse')?.body).toContain('search_dailies');
  });
});

describe('skills livrés avec l’app', () => {
  let bundled: string;

  beforeEach(() => {
    bundled = mkdtempSync(join(tmpdir(), 'skills-bundled-'));
  });

  afterEach(() => {
    rmSync(bundled, { recursive: true, force: true });
  });

  it('les lit quand l’utilisateur n’en a aucun, marqués comme tels', () => {
    write('revue/SKILL.md', '---\nname: revue\ndescription: livrée\n---\ncorps livré', bundled);
    const store = new SkillStore(dir, bundled);

    expect(store.catalog()).toEqual([{ name: 'revue', description: 'livrée', source: 'bundled' }]);
    expect(store.load('revue')?.body).toBe('corps livré');
  });

  it('un skill utilisateur PRIME sur le livré de même nom', () => {
    write('revue/SKILL.md', '---\nname: revue\ndescription: livrée\n---\ncorps livré', bundled);
    write('skills/revue.md', '---\nname: revue\ndescription: perso\n---\ncorps perso');
    const store = new SkillStore(dir, bundled);

    // Sans quoi une mise à jour de l'app écraserait la personnalisation.
    expect(store.catalog()).toEqual([{ name: 'revue', description: 'perso', source: 'user' }]);
    expect(store.load('revue')?.body).toBe('corps perso');
  });

  it('un dossier livré absent ou non fourni reste sans effet', () => {
    write('skills/perso.md', '---\nname: perso\ndescription: y\n---\nc');
    expect(new SkillStore(dir).catalog().map(s => s.name)).toEqual(['perso']);
    expect(new SkillStore(dir, join(dir, 'absent')).catalog().map(s => s.name)).toEqual(['perso']);
  });

  it('les deux skills du dépôt se lisent', () => {
    const shipped = new SkillStore(dir, join(__dirname, '..', '..', 'skills')).catalog();
    expect(shipped.map(s => s.name)).toEqual(['revue-comparee', 'verifier-source']);
    expect(shipped.every(s => s.source === 'bundled')).toBe(true);
  });
});
