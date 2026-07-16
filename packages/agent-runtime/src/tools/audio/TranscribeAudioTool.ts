import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { OcrSidecarClient } from '../../lib/ocrSidecar';

const argsSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('Absolute path to the audio file (mp3, wav, m4a, mp4, webm, ogg, flac, opus)'),
  model: z
    .enum(['tiny', 'base', 'small', 'medium', 'large-v3'])
    .default('base')
    .describe(
      'Whisper model size — tiny/base: fast; small/medium: accurate; large-v3: best quality',
    ),
  language: z
    .string()
    .optional()
    .describe('Language code (e.g. "fr", "en") — auto-detected if omitted'),
  task: z
    .enum(['transcribe', 'translate'])
    .default('transcribe')
    .describe('"transcribe" keeps original language, "translate" converts to English'),
});
type Args = z.infer<typeof argsSchema>;

interface TranscribeResult {
  text: string;
  language: string;
  languageConfidence: number;
  duration: number;
  segmentCount: number;
  segments: Array<{ start: number; end: number; text: string }>;
  model: string;
  task: string;
}

export class TranscribeAudioTool extends BaseTool<Args> {
  readonly name = 'transcribe_audio';
  readonly description =
    'Transcrit un fichier audio localement via Whisper (faster-whisper, CPU, int8). Supporte mp3/wav/m4a/mp4/webm/ogg/flac. 100% local, aucune donnée envoyée dans le cloud.';
  readonly category = 'audio' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { path, model = 'base', language, task = 'transcribe' } = rawArgs;

    if (!path?.trim()) return this.fail('path est requis');

    const client = OcrSidecarClient.get();

    try {
      const result = (await client.call(
        'audio.transcribe',
        {
          path,
          model,
          task,
          ...(language ? { language } : {}),
        },
        // Generous timeout: model loading (~30s first time) + transcription time
        // Rule of thumb: ~1min per minute of audio on CPU with base model
        600_000,
      )) as TranscribeResult;

      const minutes = Math.floor(result.duration / 60);
      const seconds = Math.round(result.duration % 60);
      const durationStr = minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;

      return this.ok({
        text: result.text,
        language: result.language,
        languageConfidence: result.languageConfidence,
        duration: result.duration,
        durationFormatted: durationStr,
        segmentCount: result.segmentCount,
        wordCount: result.text.split(/\s+/).filter(Boolean).length,
        model: result.model,
        task: result.task,
        segments: result.segments,
      });
    } catch (err) {
      const msg = String(err);
      if (msg.includes('not installed') || msg.includes('faster_whisper')) {
        return this.fail(
          'faster-whisper non installé. Dans le sidecar Python: pip install faster-whisper',
        );
      }
      return this.fail(`Transcription échouée: ${msg}`);
    }
  }
}
