import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { detectSpiral } from '../../spiral';

const argsSchema = z.object({
  events: z
    .array(
      z.object({
        at: z.string().min(1).describe('ISO timestamp or epoch ms of the event'),
        kind: z
          .string()
          .optional()
          .describe('Event kind, e.g. "edit", "run", "test_fail", "error" (optional)'),
        signature: z
          .string()
          .min(1)
          .describe(
            'What the event is about — same file path, error message, or task. Repetition of this is the spiral signal.',
          ),
      }),
    )
    .describe('Recent activity events, oldest first'),
  threshold_minutes: z
    .number()
    .default(45)
    .describe('Minutes on the same signature before flagging a spiral'),
});
type Args = z.infer<typeof argsSchema>;

export class DetectSpiralTool extends BaseTool<Args> {
  readonly name = 'detect_spiral';
  readonly description =
    "Détecte si l'utilisateur tourne en rond sur le même problème (même fichier/erreur/tâche) depuis trop longtemps, à partir d'une liste d'événements d'activité récents. Si oui, suggère une pause ou un changement d'approche. Ne notifie qu'une fois — l'app décide quand appeler.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(args: Args): Promise<ToolResult> {
    const { events, threshold_minutes = 45 } = args;

    if (!Array.isArray(events)) {
      return this.fail("events doit être un tableau d'événements {at, signature, kind?}.");
    }

    const verdict = detectSpiral(events, Math.max(1, threshold_minutes));
    return this.ok({ thresholdMinutes: threshold_minutes, eventCount: events.length, ...verdict });
  }
}
