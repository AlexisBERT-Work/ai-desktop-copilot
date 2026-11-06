import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'fs';
import { isAbsolute, join, relative, sep } from 'path';
import { createLogger } from '../logger';
import { slugify } from '../playbook/proposeSkills';

const log = createLogger('skills:store');

/**
 * Bibliothèque de skills (CATDESK-CONCEPTS-AVANCES §1 et §8-D) : ajouter une
 * procédure à l'agent en déposant un fichier, sans écrire d'outil. Ferme aussi la
 * boucle de `proposeSkills`, dont l'EvolutionDaemon écrivait des brouillons que
 * rien ne relisait.
 *
 * Format `SKILL.md` standard : frontmatter `name` / `description`, puis corps
 * Markdown. Deux dispositions, dans chaque dossier : `<nom>/SKILL.md` (celle des
 * dépôts de skills) et `<nom>.md` (celle des brouillons). Rien d'autre n'est lu :
 * ni les fichiers voisins (`scripts/`, `references/`), ni les autres clés du
 * frontmatter. `allowed-tools`, notamment, n'a aucun effet : un skill ne touche
 * jamais aux permissions (docs/SECURITE.md).
 *
 * Trois sources, par priorité décroissante :
 * - `<dataDir>/skills/` : ceux de l'utilisateur, d'origine inconnue (il a pu les
 *   prendre chez un tiers). Priment à nom égal sur les livrés, pour qu'une mise à
 *   jour de l'app n'écrase pas une personnalisation.
 * - `<bundle>/skills/` : ceux livrés avec l'app, les seuls de confiance.
 * - `<dataDir>/skill-drafts/` : brouillons auto-générés, jamais au catalogue. Ils
 *   ne se chargent qu'en les nommant : rien ne s'applique tout seul (garde-fou §8).
 *
 * AUCUN index dans le prompt système, et c'est mesuré (2026-08-16, `qwen3:14b`,
 * `think:false`, quatre formulations) : dès que les skills y sont listés, le modèle
 * produit un appel d'outil malformé qu'Ollama jette, et la réponse sort vide sur 2
 * à 5 requêtes sur 6, y compris sans rapport avec les skills. Le catalogue se
 * demande donc à l'outil (voir `LoadSkillTool`). Le prompt reste stable, et un
 * skill ne coûte rien aux tours qui ne le désignent pas.
 */

/** `draft` prime sur le dossier : voir `readSkill`. */
export type SkillSource = 'bundled' | 'user' | 'draft';

export interface SkillSummary {
  name: string;
  description: string;
  source: SkillSource;
}

export interface Skill extends SkillSummary {
  /** Corps Markdown, frontmatter retiré. */
  body: string;
}

interface SkillFile {
  slug: string;
  path: string;
}

const SKILLS_DIR = 'skills';
const DRAFTS_DIR = 'skill-drafts';
const SKILL_FILE = 'SKILL.md';

/** Le catalogue doit tenir dans le contexte, même avec beaucoup de skills. */
const DESCRIPTION_CAP = 200;
const NAME_CAP = 64;
/** Tout fichier d'un dossier est lu à chaque appel : un skill ne pèse pas si lourd. */
const MAX_FILE_BYTES = 128 * 1024;

function unquote(value: string): string {
  const quote = value[0];
  if (value.length < 2 || (quote !== '"' && quote !== "'")) return value;
  if (value[value.length - 1] !== quote) return value;
  const inner = value.slice(1, -1);
  return quote === "'" ? inner.replace(/''/g, "'") : inner.replace(/\\(["\\])/g, '$1');
}

/**
 * Frontmatter YAML réduit à ce que portent les SKILL.md, sans dépendance YAML :
 * ajouter une bibliothèque alourdirait l'installeur hors ligne pour trois clés
 * lues. Lit `clé: valeur`, les guillemets et les valeurs sur plusieurs lignes
 * (`description: >`, qu'on rencontre dans les dépôts de skills). Une clé imbriquée
 * (`metadata:` + retrait) reste dans la valeur de son parent : elle ne peut pas se
 * faire passer pour une clé de premier niveau.
 */
export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  // Un fichier rédigé sous Windows porte souvent un BOM, qui masquerait le `---`.
  const text = raw.replace(/^\uFEFF/, '');
  if (!/^---[ \t]*\r?\n/.test(text)) return { meta: {}, body: text.trim() };

  const end = text.search(/\r?\n---[ \t]*(\r?\n|$)/);
  if (end === -1) return { meta: {}, body: text.trim() };

  const lines = text.slice(text.indexOf('\n') + 1, end).split(/\r?\n/);
  const body = text.slice(end).replace(/^\r?\n---[ \t]*(\r?\n)?/, '');

  const meta: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/.exec(lines[i] ?? '');
    if (!match?.[1]) continue;

    const first = (match[2] ?? '').trim();
    const parts = /^[|>][+-]?\d?$/.test(first) ? [] : [first];
    // Une ligne en retrait ou vide prolonge la valeur de la clé.
    let next = lines[i + 1];
    while (next !== undefined && /^([ \t]|$)/.test(next)) {
      parts.push(next.trim());
      i++;
      next = lines[i + 1];
    }
    meta[match[1].toLowerCase()] = unquote(parts.filter(Boolean).join(' '));
  }
  return { meta, body: body.trim() };
}

function skillFiles(root: string): SkillFile[] {
  const files: SkillFile[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const path = join(root, entry.name, SKILL_FILE);
      if (existsSync(path)) files.push({ slug: entry.name, path });
    } else if (/\.md$/i.test(entry.name)) {
      files.push({ slug: entry.name.replace(/\.md$/i, ''), path: join(root, entry.name) });
    }
  }
  return files;
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Lit un skill, ou le refuse (`null`, avec un avertissement au journal).
 *
 * Un lien qui sort du dossier est refusé : `load_skill` est auto-approuvé et ne
 * passe pas par la liste blanche des chemins, donc un `SKILL.md` qui pointerait vers
 * un fichier privé le ferait lire sans contrôle. Un fichier sans `description`
 * n'est pas un skill : un README posé là n'en devient pas un.
 */
function readSkill(realRoot: string, file: SkillFile, source: SkillSource): Skill | null {
  const refuse = (reason: string): null => {
    log.warn('Skill ignored', { file: file.path, reason });
    return null;
  };

  const real = realpathSync(file.path);
  if (!isInside(realRoot, real)) return refuse('lien hors du dossier');
  if (statSync(real).size > MAX_FILE_BYTES) return refuse('fichier trop gros');

  const { meta, body } = parseFrontmatter(readFileSync(real, 'utf-8'));
  const name = meta['name'] || file.slug;
  const description = meta['description'];
  if (!description) return refuse('pas de description');
  if (body.length === 0) return refuse('corps vide');
  if (name.length > NAME_CAP || slugify(name).length === 0) return refuse('nom invalide');

  return {
    name,
    description:
      description.length > DESCRIPTION_CAP
        ? `${description.slice(0, DESCRIPTION_CAP)}…`
        : description,
    // Le statut prime sur l'emplacement : on ne promeut pas un brouillon en
    // déplaçant son fichier, il faut retirer `status: draft`.
    source: meta['status']?.toLowerCase() === 'draft' ? 'draft' : source,
    body,
  };
}

function scan(root: string, source: SkillSource): Skill[] {
  if (!existsSync(root)) return [];

  const skills: Skill[] = [];
  try {
    const realRoot = realpathSync(root);
    for (const file of skillFiles(root)) {
      try {
        const skill = readSkill(realRoot, file, source);
        if (skill) skills.push(skill);
      } catch (err) {
        log.warn('Skill unreadable', { file: file.path, error: String(err) });
      }
    }
  } catch (err) {
    log.warn('Skill dir unreadable', { dir: root, error: String(err) });
  }
  return skills;
}

export class SkillStore {
  /**
   * @param dataDir    Données de l'utilisateur (`skills/` et `skill-drafts/`).
   * @param bundledDir Skills livrés avec l'app. Tous ces dossiers peuvent manquer.
   */
  constructor(
    private readonly dataDir: string,
    private readonly bundledDir?: string,
  ) {}

  /**
   * Skills validés, sans leur corps, triés par nom. Les brouillons n'y figurent
   * pas : le modèle ne peut pas découvrir ce qu'on ne lui a pas nommé.
   */
  catalog(): SkillSummary[] {
    const byName = new Map<string, SkillSummary>();
    for (const { name, description, source } of this.all()) {
      const key = slugify(name);
      if (source !== 'draft' && !byName.has(key)) byName.set(key, { name, description, source });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Un skill par son nom, sans souci de casse, d'accents ni d'espaces : le modèle
   * écrit volontiers « vérifier source » pour `verifier-source`. `name` n'est jamais
   * un chemin : il est comparé aux skills trouvés, pas concaténé à un dossier.
   */
  load(name: string): Skill | null {
    const wanted = slugify(name);
    if (wanted.length === 0) return null;
    const matches = this.all().filter(s => slugify(s.name) === wanted);
    // Un brouillon ne prend jamais la place d'un skill validé de même nom.
    return matches.find(s => s.source !== 'draft') ?? matches[0] ?? null;
  }

  /**
   * Relu à chaque appel, par ordre de priorité : quelques petits fichiers, rien
   * devant une inférence locale, et un skill qu'on rédige prend effet aussitôt.
   */
  private all(): Skill[] {
    return [
      ...scan(join(this.dataDir, SKILLS_DIR), 'user'),
      ...(this.bundledDir === undefined ? [] : scan(this.bundledDir, 'bundled')),
      ...scan(join(this.dataDir, DRAFTS_DIR), 'draft'),
    ];
  }
}
