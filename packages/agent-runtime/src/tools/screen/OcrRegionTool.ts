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
  fullScreen: z.boolean().default(false),
  language: z.string().default('fra+eng').describe('Tesseract language codes'),
});
type Args = z.infer<typeof argsSchema>;

interface OcrResult {
  text: string;
  confidence: number;
  imageBase64: string;
}

export class OcrRegionTool extends BaseTool<Args> {
  readonly name = 'ocr_region';
  readonly description =
    "Lit le texte visible à l'écran via OCR Tesseract. Capture l'écran (ou une région) et en extrait tout le texte reconnu avec son niveau de confiance.";
  readonly category = 'screen' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const args = rawArgs;
    const client = OcrSidecarClient.get();

    try {
      const result = (await client.call(
        'ocr.capture_and_read',
        {
          ...(args.region ? { region: args.region } : {}),
          activeWindowOnly: false,
          language: args.language ?? 'fra+eng',
        },
        45_000, // OCR can take a few seconds on large screens
      )) as OcrResult;

      return this.ok({
        text: result.text,
        confidence: result.confidence,
        charCount: result.text.length,
        wordCount: result.text.split(/\s+/).filter(Boolean).length,
        // Return image only if meaningful (avoids flooding context with large base64)
        ...(result.imageBase64.length < 200_000 ? { imageBase64: result.imageBase64 } : {}),
      });
    } catch (err) {
      return this.fail(
        `OCR échoué: ${String(err)}. Vérifiez que Tesseract est installé et que le sidecar OCR tourne.`,
      );
    }
  }
}
