import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { OcrSidecarClient } from '../../lib/ocrSidecar';
import type { OllamaClient } from '../../llm/OllamaClient';

interface Args {
  prompt?: string;
  region?: { x: number; y: number; width: number; height: number };
  activeWindowOnly?: boolean;
}

const DEFAULT_PROMPT = "Décris en détail ce qui est affiché à l'écran.";

/**
 * Capture l'écran et le décrit **visuellement** via un modèle multimodal
 * (ex. llava). Complète `ocr_region` (texte) en comprenant la mise en page,
 * les images, les éléments d'interface.
 */
export class DescribeScreenTool extends BaseTool {
  name = 'describe_screen';
  description =
    "Capture l'écran (ou une région / la fenêtre active) et le décrit visuellement " +
    "via un modèle de vision. Utiliser pour 'que vois-tu', analyser une UI, un graphique, une image.";
  category = 'screen' as const;
  riskLevel = 'low' as const;
  requiresConfirmation = false;
  schema = TOOL_SCHEMAS.describe_screen;

  constructor(private llm: OllamaClient, private visionModel: string) {
    super();
  }

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as Args;
    const prompt = args.prompt?.trim() || DEFAULT_PROMPT;

    // 1) Capture via le sidecar Python (mss)
    let imageBase64: string;
    try {
      const cap = (await OcrSidecarClient.get().call(
        'screen.capture',
        {
          ...(args.region ? { region: args.region } : {}),
          activeWindowOnly: args.activeWindowOnly ?? false,
        },
        20_000,
      )) as { imageBase64?: string };
      if (!cap.imageBase64) return this.fail('Capture vide');
      imageBase64 = cap.imageBase64;
    } catch (err) {
      return this.fail(`Capture d'écran impossible: ${String(err)}`);
    }

    // 2) Description par le modèle de vision (image jointe au message)
    try {
      let description = '';
      const stream = this.llm.streamChat({
        model: this.visionModel,
        messages: [{ role: 'user', content: prompt, images: [imageBase64] }],
        temperature: 0.2,
      });
      for await (const chunk of stream) {
        if (chunk.type === 'token') description += chunk.content;
        else if (chunk.type === 'error') {
          return this.fail(
            `Modèle de vision indisponible (${this.visionModel}): ${chunk.error}. ` +
              `Installe-le avec \`ollama pull ${this.visionModel}\`.`,
          );
        }
      }

      const text = description.trim();
      if (!text) return this.fail('Le modèle de vision n\'a rien renvoyé');
      return this.ok({ description: text, model: this.visionModel, source: args.region ? 'region' : args.activeWindowOnly ? 'active_window' : 'fullscreen' });
    } catch (err) {
      return this.fail(`Description impossible: ${String(err)}`);
    }
  }
}
