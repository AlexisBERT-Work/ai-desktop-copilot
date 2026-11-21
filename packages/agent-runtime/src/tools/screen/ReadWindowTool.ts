import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { DesktopHost } from '../../lib/desktopHost';

const argsSchema = z.object({
  window: z
    .string()
    .max(200)
    .optional()
    .describe("Titre (ou partie), nom d'appli ou id de la fenêtre ; vide : liste des fenêtres"),
});
type Args = z.infer<typeof argsSchema>;

/**
 * Lit une fenêtre par l'arbre d'accessibilité Windows (UI Automation) : une
 * liste numérotée d'éléments (boutons, champs, textes, document), plus fiable
 * et moins chère qu'une capture + OCR. Le cœur Rust fait la lecture, la borne
 * (80 lignes, 4 000 caractères, 3 s) et ne lit jamais un champ mot de passe :
 * voir `core/desktop.rs`. Une appli sans accessibilité ne rend rien : repli
 * `ocr_region`.
 */
export class ReadWindowTool extends BaseTool<Args> {
  readonly name = 'read_window';
  readonly description =
    "Lit le contenu d'une fenêtre Windows (boutons, champs, textes) ; sans fenêtre, liste les fenêtres ouvertes.";
  readonly category = 'screen' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private readonly host: () => DesktopHost = () => DesktopHost.get()) {
    super();
  }

  async execute(args: Args): Promise<ToolResult> {
    const window = args.window?.trim();
    const result =
      window === undefined || window.length === 0
        ? await this.host().request('list_windows', {})
        : await this.host().request('read_window', { window });
    return result.ok ? this.ok(result.data) : this.fail(result.error);
  }
}
