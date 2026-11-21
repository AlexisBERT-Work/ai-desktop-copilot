import { z } from 'zod';
import { extname } from 'path';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { OcrSidecarClient } from '../../lib/ocrSidecar';

const argsSchema = z.object({
  path: z.string().trim().min(1).describe('Chemin absolu du fichier à vérifier'),
});
type Args = z.infer<typeof argsSchema>;

/** Formats inspectés par le sidecar (`files/leak_inspector.py`). */
export const LEAK_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.tif',
  '.tiff',
  '.webp',
  '.pdf',
  '.docx',
  '.docm',
  '.xlsx',
  '.xlsm',
  '.pptx',
  '.pptm',
  '.odt',
  '.ods',
  '.odp',
] as const;

type SidecarCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

const defaultCall: SidecarCall = (method, params) =>
  OcrSidecarClient.get().call(method, params, 60_000);

/**
 * Ce qu'un fichier révèle avant d'être partagé (veille du 16/11) : position
 * GPS d'une photo, auteurs, commentaires, suivi des modifications, texte
 * masqué, révisions empilées d'un PDF, chemins du poste… Lecture seule et
 * locale (risque `low`) : rien n'est modifié ni envoyé. Sortie bornée côté
 * Python (30 constats, des noms et des nombres plutôt que le contenu).
 */
export class InspectFileLeaksTool extends BaseTool<Args> {
  readonly name = 'inspect_file_leaks';
  readonly description =
    "Liste ce qu'un fichier révèle avant de l'envoyer : GPS, auteurs, commentaires, modifications suivies, texte masqué.";
  readonly category = 'filesystem' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  override readonly pathArgs = ['path'] as const;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private readonly call: SidecarCall = defaultCall) {
    super();
  }

  async execute(args: Args): Promise<ToolResult> {
    const ext = extname(args.path).toLowerCase();
    if (!(LEAK_EXTENSIONS as readonly string[]).includes(ext)) {
      return this.fail(
        `Format non inspecté (${ext || 'sans extension'}). Acceptés : ${LEAK_EXTENSIONS.join(', ')}`,
      );
    }
    try {
      return this.ok(await this.call('files.inspect_leaks', { path: args.path }));
    } catch (err) {
      const msg = String(err);
      if (msg.includes('No such file') || msg.includes('Errno 2')) {
        return this.fail(`Fichier introuvable : ${args.path}`);
      }
      if (msg.includes("n'est pas installé")) {
        return this.fail(`Dépendance Python manquante : ${msg}`);
      }
      return this.fail(`Inspection échouée : ${msg}`);
    }
  }
}
