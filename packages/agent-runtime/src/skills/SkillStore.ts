import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../logger';

const log = createLogger('skills:store');

/**
 * Bibliothèque de skills (CATDESK-CONCEPTS-AVANCES §1 « harness » + §8-D).
 *
 * Ferme la boucle laissée ouverte par `proposeSkills` : l'EvolutionDaemon savait
 * *écrire* des SKILL.md dans `skill-drafts/`, mais rien ne savait les *relire*.
 *
 * Principe repris de la pratique établie sur les agents de code (cf. veille
 * 2026-08-16, mattpocock/skills) : la **divulgation progressive**. Seul le
 * couple `name` + `description` entre dans le system prompt — payé à chaque
 * tour, donc gardé minuscule. Le corps du skill n'est chargé qu'à la demande,
 * via l'outil `load_skill`. C'est le §2 (context engineering) appliqué au
 * prompt lui-même : sur 10 Go de VRAM, le contexte est aussi rare que la VRAM.
 *
 * Trois sources, par priorité décroissante :
 * - `<dataDir>/skills/`  — skills de l'utilisateur, **indexés**. Priment sur les
 *   embarqués à nom égal : c'est ainsi qu'on personnalise un skill livré sans
 *   modifier l'installation (une mise à jour l'écraserait).
 * - `<bundle>/skills/`   — skills livrés avec l'application, **indexés**.
 * - `<dataDir>/skill-drafts/` — brouillons auto-générés, **jamais indexés**. Ils
 *   restent chargeables si on les nomme explicitement (revue par l'utilisateur),
 *   ce qui préserve le garde-fou §8 : rien ne s'applique tout seul, puisque le
 *   modèle ne peut pas découvrir un brouillon qu'on ne lui a pas nommé.
 */

export interface SkillSummary {
  name: string;
  description: string;
  /** Brouillon auto-généré ou marqué `status: draft` — non indexé, non validé. */
  draft: boolean;
}

export interface Skill extends SkillSummary {
  /** Corps Markdown, frontmatter retiré. */
  body: string;
}

const SKILLS_DIR = 'skills';
const DRAFTS_DIR = 'skill-drafts';

/** Descriptions bornées : ce texte est payé à CHAQUE tour de conversation. */
const DESCRIPTION_CAP = 200;

/**
 * Frontmatter YAML plat (`clé: valeur`), sans dépendance YAML : c'est le format
 * émis par `proposeSkills` et celui des SKILL.md en pratique. Ajouter js-yaml
 * pour ça alourdirait un installeur hors-ligne sans rien apporter. Les valeurs
 * entourées de guillemets sont déquotées ; le reste est pris tel quel.
 */
export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  // BOM échappé : un fichier rédigé sous Windows en porte souvent un, et il
  // empêcherait le `---` d'ouverture d'être reconnu.
  const normalized = raw.replace(/^\uFEFF/, '');
  if (!/^---[ \t]*\r?\n/.test(normalized)) return { meta: {}, body: normalized.trim() };

  // Fin du bloc : la première ligne `---` qui suit l'ouvrante.
  const end = normalized.search(/\r?\n---[ \t]*(\r?\n|$)/);
  if (end === -1) return { meta: {}, body: normalized.trim() };

  const header = normalized.slice(normalized.indexOf('\n') + 1, end);
  const body = normalized.slice(end).replace(/^\r?\n---[ \t]*(\r?\n)?/, '');

  const meta: Record<string, string> = {};
  for (const line of header.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (!m?.[1]) continue;
    meta[m[1].toLowerCase()] = (m[2] ?? '').trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { meta, body: body.trim() };
}

/** Nom de fichier → slug (`auto-tests.md` → `auto-tests`). */
function slugOf(file: string): string {
  return file.replace(/\.md$/i, '');
}

export class SkillStore {
  /**
   * @param dataDir    Données de l'utilisateur (`skills/` + `skill-drafts/`).
   * @param bundledDir Dossier des skills livrés avec l'app. Optionnel : absent
   *   en test, et une installation sans skills embarqués reste valide.
   */
  constructor(
    private readonly dataDir: string,
    private readonly bundledDir?: string,
  ) {}

  /**
   * Skills validés, résumés (name + description). C'est le SEUL contenu skill
   * qui entre dans le system prompt.
   *
   * Relu à chaque appel (une fois par run) : quelques petits fichiers, coût
   * négligeable devant une inférence locale, et une modification de skill prend
   * effet immédiatement — ce qui compte quand on en rédige un.
   */
  index(): SkillSummary[] {
    const byName = new Map<string, SkillSummary>();
    // Ordre inverse de priorité : l'utilisateur écrit par-dessus l'embarqué.
    for (const s of [...this.scanBundled(), ...this.scanUser()]) {
      if (s.draft) continue;
      byName.set(s.name.toLowerCase(), {
        name: s.name,
        description: s.description,
        draft: s.draft,
      });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Corps complet d'un skill, par nom. Utilisateur d'abord (il prime), puis
   * embarqués, puis brouillons (ces derniers accessibles seulement si l'appelant
   * connaît déjà le nom — voir le garde-fou §8 en tête de fichier).
   * `null` si introuvable.
   */
  load(name: string): Skill | null {
    const wanted = name.trim().toLowerCase();
    if (wanted.length === 0) return null;
    const all = [...this.scanUser(), ...this.scanBundled(), ...this.scanDrafts()];
    return all.find(s => s.name.toLowerCase() === wanted) ?? null;
  }

  /** Noms des brouillons en attente de revue (informatif — jamais indexés). */
  pendingDrafts(): string[] {
    return [...this.scanUser(), ...this.scanBundled(), ...this.scanDrafts()]
      .filter(s => s.draft)
      .map(s => s.name)
      .sort();
  }

  private scanUser(): Skill[] {
    return this.scan(join(this.dataDir, SKILLS_DIR), false);
  }

  private scanDrafts(): Skill[] {
    return this.scan(join(this.dataDir, DRAFTS_DIR), true);
  }

  private scanBundled(): Skill[] {
    return this.bundledDir === undefined ? [] : this.scan(this.bundledDir, false);
  }

  /** Lit un dossier de skills. `dirIsDrafts` force le statut brouillon. */
  private scan(full: string, dirIsDrafts: boolean): Skill[] {
    if (!existsSync(full)) return [];

    let files: string[];
    try {
      files = readdirSync(full).filter(f => /\.md$/i.test(f));
    } catch (err) {
      log.warn('Skill dir unreadable', { dir: full, error: String(err) });
      return [];
    }

    const skills: Skill[] = [];
    for (const file of files) {
      try {
        const raw = readFileSync(join(full, file), 'utf-8');
        const { meta, body } = parseFrontmatter(raw);
        const description = meta['description']?.trim();
        skills.push({
          name: meta['name']?.trim() || slugOf(file),
          description:
            description === undefined || description.length === 0
              ? `Skill « ${slugOf(file)} » (sans description).`
              : description.length > DESCRIPTION_CAP
                ? `${description.slice(0, DESCRIPTION_CAP)}…`
                : description,
          // Le statut prime sur l'emplacement : un fichier marqué `status: draft`
          // reste un brouillon même déposé dans skills/ (on ne promeut pas un
          // skill par simple déplacement de fichier).
          draft: dirIsDrafts || meta['status']?.toLowerCase() === 'draft',
          body,
        });
      } catch (err) {
        log.warn('Skill unreadable — skipped', { file, error: String(err) });
      }
    }
    return skills;
  }
}
