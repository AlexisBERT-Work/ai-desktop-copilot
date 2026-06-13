import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { OcrSidecarClient } from '../../lib/ocrSidecar';

interface OcrRegionArgs {
  region?: { x: number; y: number; width: number; height: number };
  fullScreen?: boolean;
  language?: string;
}

interface OcrResult {
  text: string;
  confidence: number;
  imageBase64: string;
}

export class OcrRegionTool extends BaseTool {
  readonly name = 'ocr_region';
  readonly description = 'Lit le texte visible à l\'écran via OCR Tesseract. Capture l\'écran (ou une région) et en extrait tout le texte reconnu avec son niveau de confiance.';
  readonly category = 'screen' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.ocr_region;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as OcrRegionArgs;
    const client = OcrSidecarClient.get();

    try {
      const result = await client.call(
        'ocr.capture_and_read',
        {
          ...(args.region ? { region: args.region } : {}),
          activeWindowOnly: false,
          language: args.language ?? 'fra+eng',
        },
        45_000, // OCR can take a few seconds on large screens
      ) as OcrResult;

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
