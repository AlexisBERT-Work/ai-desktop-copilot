import { useEffect, useState } from 'react';
import type { VoiceVocabulary } from '@catdesk/shared-types';
import { voiceVocabularyGet, voiceVocabularySet } from '../../shared/api/voice';
import { BTN_GHOST_SM, FIELD, LABEL } from '../../shared/ui/tokens';
import { summaryLine } from './vocabularySummary';

const EXAMPLE = `CatDesk
Supabase = supa base
Ollama = olama
Siobhan = chivonne`;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Vocabulaire de la reconnaissance vocale : le fichier vit côté Rust
 * (`<données>/voice/vocabulaire.txt`), qui le vérifie et le met en service.
 * Ici, on l'affiche et on l'envoie.
 */
export function VocabularyCard({ disabled }: { disabled: boolean }) {
  const [saved, setSaved] = useState<VoiceVocabulary | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    voiceVocabularyGet()
      .then(v => {
        if (!alive) return;
        setSaved(v);
        setText(v.text);
      })
      .catch(err => alive && setError(message(err)));
    return () => {
      alive = false;
    };
  }, []);

  const dirty = saved !== null && text !== saved.text;

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const v = await voiceVocabularySet(text);
      setSaved(v);
      setText(v.text);
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-3 space-y-2">
      <label className={LABEL} htmlFor="voice-vocabulary">
        Vocabulaire
      </label>
      <p className="text-xs text-white/45">
        Un nom par ligne, écrit comme tu veux le lire. Après « = », ce que la voix écrit à sa place,
        séparé par des virgules. Jamais de mot courant, ni comme nom ni comme variante : « Mistral »
        prendrait une majuscule partout, et « Ollama = la main » remplacerait chaque « la main ».
      </p>
      <textarea
        id="voice-vocabulary"
        rows={6}
        spellCheck={false}
        className={`${FIELD} font-mono text-xs`}
        placeholder={EXAMPLE}
        value={text}
        disabled={disabled || saved === null}
        onChange={e => setText(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={BTN_GHOST_SM}
          disabled={disabled || !dirty || saving}
          onClick={() => void save()}
        >
          Enregistrer
        </button>
        {saved && <p className="text-xs text-white/45">{summaryLine(saved)}</p>}
      </div>
      {saved?.problems.map(p => (
        <p key={p} className="text-xs text-orange-300/90">
          {p}
        </p>
      ))}
      {error && (
        <p role="alert" className="text-xs text-orange-300/90">
          {error}
        </p>
      )}
      {saved?.path && <p className="text-xs text-white/35 break-all">Fichier : {saved.path}</p>}
    </div>
  );
}
