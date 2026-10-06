import { Loader2, Mic, MicOff, Volume2 } from 'lucide-react';
import { useVoiceStore } from './voiceStore';

interface Props {
  /** `sm` pour la bulle, `md` pour la zone de saisie du chat. */
  size?: 'sm' | 'md';
}

/**
 * Bouton micro : un clic écoute, un clic pendant l'écoute arrête, un clic
 * pendant la parole la coupe. Le halo suit le niveau du micro pour que
 * l'utilisateur voie qu'il est entendu — indispensable quand un micro est ouvert.
 */
export function VoiceButton({ size = 'md' }: Props) {
  const state = useVoiceStore(s => s.state);
  const level = useVoiceStore(s => s.level);
  const enabled = useVoiceStore(s => s.enabled);
  const sttAvailable = useVoiceStore(s => s.status?.sttAvailable ?? false);
  const hint = useVoiceStore(s => s.hint);
  const toggleListening = useVoiceStore(s => s.toggleListening);

  const icon = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const pad = size === 'sm' ? 'p-1.5' : 'p-2';
  const usable = enabled && sttAvailable;

  const title = !enabled
    ? 'Voix désactivée (Paramètres › Voix)'
    : !sttAvailable
      ? (hint ?? 'Modèles de reconnaissance absents')
      : state === 'listening'
        ? 'J’écoute — cliquer pour arrêter'
        : state === 'transcribing'
          ? 'Je transcris…'
          : state === 'speaking'
            ? 'Cliquer pour me couper'
            : (hint ?? 'Parler à CatDesk (Ctrl+Espace)');

  // Halo proportionnel au niveau : 0 → rien, 1 → 14 px.
  const halo =
    state === 'listening'
      ? `0 0 0 ${Math.round(2 + level * 12)}px rgba(248,113,113,.25)`
      : undefined;

  const tone =
    state === 'listening'
      ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
      : state === 'speaking'
        ? 'bg-brand-500/20 text-brand-300 hover:bg-brand-500/30'
        : state === 'transcribing'
          ? 'text-brand-300'
          : 'text-white/30 hover:text-white/70 hover:bg-white/5';

  return (
    <button
      type="button"
      onClick={() => void toggleListening()}
      disabled={!usable && state === 'idle'}
      title={title}
      aria-label={title}
      aria-pressed={state === 'listening'}
      className={`${pad} rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${tone}`}
      style={halo ? { boxShadow: halo } : undefined}
    >
      {state === 'listening' ? (
        <Mic className={icon} />
      ) : state === 'transcribing' ? (
        <Loader2 className={`${icon} animate-spin`} />
      ) : state === 'speaking' ? (
        <Volume2 className={icon} />
      ) : usable ? (
        <Mic className={icon} />
      ) : (
        <MicOff className={icon} />
      )}
    </button>
  );
}
