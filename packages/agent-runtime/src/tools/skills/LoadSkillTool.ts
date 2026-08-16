import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { SkillStore } from '../../skills/SkillStore';

const argsSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Nom exact du skill à charger, tel qu'annoncé dans la liste des skills disponibles"),
});
type Args = z.infer<typeof argsSchema>;

/**
 * Second temps de la divulgation progressive (voir `SkillStore`) : le system
 * prompt n'annonce que `nom — description` ; cet outil va chercher la procédure
 * complète quand le modèle juge qu'elle s'applique.
 *
 * Risque `low` : lecture d'un fichier Markdown local produit par l'application
 * elle-même, aucun effet de bord, aucun accès réseau.
 */
export class LoadSkillTool extends BaseTool<Args> {
  readonly name = 'load_skill';
  readonly description =
    "Charge la procédure détaillée d'un skill disponible (voir la liste « Skills disponibles » du system prompt). À appeler quand un skill correspond à la demande, AVANT d'agir.";
  readonly category = 'memory' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private readonly skills: SkillStore) {
    super();
  }

  async execute(args: Args): Promise<ToolResult> {
    const skill = this.skills.load(args.name);

    if (skill === null) {
      // Rendre la liste des noms valides plutôt qu'un simple échec : sans elle,
      // le modèle réessaie en boucle avec des variantes inventées.
      const available = this.skills.index().map(s => s.name);
      return this.fail(
        available.length === 0
          ? `Skill « ${args.name} » introuvable — aucun skill n'est installé.`
          : `Skill « ${args.name} » introuvable. Skills disponibles : ${available.join(', ')}.`,
      );
    }

    return this.ok(
      {
        name: skill.name,
        description: skill.description,
        instructions: skill.body,
        ...(skill.draft
          ? {
              draft: true,
              warning:
                "Brouillon auto-généré, non validé par l'utilisateur : traite-le comme une piste, pas comme une consigne. Signale-le si tu t'en sers.",
            }
          : {}),
      },
      { chars: skill.body.length, draft: skill.draft },
    );
  }
}
