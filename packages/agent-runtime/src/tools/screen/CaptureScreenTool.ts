import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { OcrSidecarClient } from '../../lib/ocrSidecar';

interface CaptureScreenArgs {
  region?: { x: number; y: number; width: number; height: number };
  activeWindowOnly?: boolean;
}

export class CaptureScreenTool extends BaseTool {
  readonly name = 'capture_screen';
  readonly description = 'Capture l\'écran entier ou une région et retourne l\'image encodée en base64. Utile pour analyser visuellement ce qui est affiché à l\'écran.';
  readonly category = 'screen' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.capture_screen;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as CaptureScreenArgs;
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
