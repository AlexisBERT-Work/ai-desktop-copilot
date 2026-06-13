import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { OcrSidecarClient } from '../../lib/ocrSidecar';

interface TranscribeAudioArgs {
  path: string;
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';
  language?: string;
  task?: 'transcribe' | 'translate';
}

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

export class TranscribeAudioTool extends BaseTool {
  readonly name = 'transcribe_audio';
  readonly description = 'Transcrit un fichier audio localement via Whisper (faster-whisper, CPU, int8). Supporte mp3/wav/m4a/mp4/webm/ogg/flac. 100% local, aucune donnée envoyée dans le cloud.';
  readonly category = 'audio' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.transcribe_audio;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { path, model = 'base', language, task = 'transcribe' } = rawArgs as TranscribeAudioArgs;

    if (!path?.trim()) return this.fail('path est requis');

    const client = OcrSidecarClient.get();

    try {
      const result = await client.call(
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
      ) as TranscribeResult;

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
