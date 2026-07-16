import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { OcrSidecarClient } from '../../lib/ocrSidecar';

const argsSchema = z.object({
  region: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    })
    .optional(),
  activeWindowOnly: z.boolean().default(false),
});
type Args = z.infer<typeof argsSchema>;

export class CaptureScreenTool extends BaseTool<Args> {
  readonly name = 'capture_screen';
  readonly description =
    "Capture l'écran entier ou une région et retourne l'image encodée en base64. Utile pour analyser visuellement ce qui est affiché à l'écran.";
  readonly category = 'screen' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const args = rawArgs;
    const client = OcrSidecarClient.get();

    try {
      const result = await client.call(
        'screen.capture',
        {
          ...(args.region ? { region: args.region } : {}),
          activeWindowOnly: args.activeWindowOnly ?? false,
        },
        20_000,
      );
      return this.ok(result);
    } catch (err) {
      return this.fail(
        `Capture d'écran impossible: ${String(err)}. Vérifiez que le sidecar OCR est démarré (packages/ocr-vision/.venv/Scripts/python.exe).`,
      );
    }
  }
}
