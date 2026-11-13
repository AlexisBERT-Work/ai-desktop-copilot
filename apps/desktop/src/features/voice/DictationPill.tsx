import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AlertTriangle, Check, Loader2, Mic } from 'lucide-react';
import { TAURI_EVENTS } from '@catdesk/shared-types';
import type { VoiceDictationEvent, VoiceLevelEvent } from '@catdesk/shared-types';
import { pillView, RESULT_MS, type PillTone } from './dictationPillView';

/**
 * Pastille de dictée — fenêtre `dictation-pill`, créée par Rust quand la
 * dictée est activée, jamais focalisable et traversée par la souris.
 *
 * Elle reste toujours affichée (un `show()` pourrait voler le focus à la
 * fenêtre où l'on dicte) : au repos, elle ne rend rien et la fenêtre est
 * transparente. Elle ne montre jamais le texte dicté, seulement son état.
 */

const TONE_CLASS: Record<PillTone, string> = {
  recording: 'border-red-400/40 text-red-100',
  busy: 'border-white/15 text-white/80',
  ok: 'border-green-400/30 text-green-100',
  warn: 'border-orange-400/40 text-orange-100',
};

export function DictationPill() {
  const [event, setEvent] = useState<VoiceDictationEvent | null>(null);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    let clear: ReturnType<typeof setTimeout> | undefined;
    const subscriptions = [
      listen<VoiceDictationEvent>(TAURI_EVENTS.voiceDictation, e => {
        if (clear !== undefined) clearTimeout(clear);
        setEvent(e.payload);
        if (e.payload.phase === 'recording') setLevel(0);
        if (e.payload.phase === 'done') clear = setTimeout(() => setEvent(null), RESULT_MS);
      }),
      listen<VoiceLevelEvent>(TAURI_EVENTS.voiceLevel, e => setLevel(e.payload.rms)),
    ];
    return () => {
      if (clear !== undefined) clearTimeout(clear);
      for (const sub of subscriptions) void sub.then(unlisten => unlisten());
    };
  }, []);

  const view = pillView(event);
  if (!view) return null;

  const icon =
    view.tone === 'recording' ? (
      <Mic
        className="w-4 h-4 shrink-0 text-red-300"
        style={{ transform: `scale(${1 + Math.min(level, 1) * 0.6})` }}
      />
    ) : view.tone === 'busy' ? (
      <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
    ) : view.tone === 'ok' ? (
      <Check className="w-4 h-4 shrink-0 text-green-300" />
    ) : (
      <AlertTriangle className="w-4 h-4 shrink-0 text-orange-300" />
    );

  return (
    <div className="flex h-screen w-screen items-center justify-center p-1.5">
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-2 rounded-full border bg-neutral-900/90 px-4 py-2 text-xs font-medium shadow-lg ${TONE_CLASS[view.tone]}`}
      >
        {icon}
        <span className="truncate">{view.text}</span>
      </div>
    </div>
  );
}
