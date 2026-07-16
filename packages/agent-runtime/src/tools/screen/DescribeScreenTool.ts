import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { OcrSidecarClient } from '../../lib/ocrSidecar';
import type { OllamaClient } from '../../llm/OllamaClient';

const argsSchema = z.object({
  prompt: z
    .string()
    .optional()
    .describe("Question ou consigne sur ce qui est affiché (ex. 'Que montre cet écran ?')"),
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

// English on purpose: LLaVA-family vision models describe far better in English
// and tend to refuse French ("je ne parle pas français") instead of describing.
// The agent's main model (qwen) relays the result to the user in French.
const DEFAULT_PROMPT = 'Describe in detail what is shown on this screen.';

/**
 * Capture l'écran et le décrit **visuellement** via un modèle multimodal
 * (ex. llava). Complète `ocr_region` (texte) en comprenant la mise en page,
 * les images, les éléments d'interface.
 */
export class DescribeScreenTool extends BaseTool<Args> {
  name = 'describe_screen';
  description =
    "Capture l'écran (ou une région / la fenêtre active) et le décrit visuellement " +
    "via un modèle de vision. Utiliser pour 'que vois-tu', analyser une UI, un graphique, une image.";
  category = 'screen' as const;
  riskLevel = 'low' as const;
  requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(
    private llm: OllamaClient,
    private visionModel: string,
  ) {
    super();
  }

  async execute(rawArgs: Args): Promise<ToolResult> {
    const args = rawArgs;
    // Force English output even when the caller (agent) passes a French prompt:
    // see DEFAULT_PROMPT. The orchestrator translates the result for the user.
    const ask = args.prompt?.trim();
    const prompt = ask ? `Look at this screenshot and answer in English.\n${ask}` : DEFAULT_PROMPT;

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
      if (!text) return this.fail("Le modèle de vision n'a rien renvoyé");
      return this.ok({
        description: text,
        model: this.visionModel,
        source: args.region ? 'region' : args.activeWindowOnly ? 'active_window' : 'fullscreen',
      });
    } catch (err) {
      return this.fail(`Description impossible: ${String(err)}`);
    }
  }
}
