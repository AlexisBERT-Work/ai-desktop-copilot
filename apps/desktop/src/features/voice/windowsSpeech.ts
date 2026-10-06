import type { VoiceState } from '@catdesk/shared-types';

/**
 * Voix de secours : `window.speechSynthesis` (voix Windows, « Hortense »).
 * Utilisée quand les modèles Piper manquent. Fonctionne dans WebView2 —
 * contrairement à `SpeechRecognition`, qui n'y renvoie jamais rien.
 *
 * Les phrases s'enchaînent dans la file du navigateur ; `onState` reçoit
 * `speaking` à la première et `idle` quand la dernière est finie.
 */
export function createWindowsSpeech(onState: (state: VoiceState) => void) {
  let pending = 0;

  const pickVoice = (): SpeechSynthesisVoice | null => {
    if (typeof speechSynthesis === 'undefined') return null;
    const voices = speechSynthesis.getVoices();
    return voices.find(v => v.lang.toLowerCase().startsWith('fr')) ?? voices[0] ?? null;
  };

  const settle = () => {
    pending = Math.max(0, pending - 1);
    if (pending === 0) onState('idle');
  };

  return {
    available(): boolean {
      return (
        typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'
      );
    },
    speak(sentence: string, rate: number): void {
      if (!this.available()) return;
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.lang = 'fr-FR';
      utterance.rate = rate;
      const voice = pickVoice();
      if (voice) utterance.voice = voice;
      utterance.onend = settle;
      utterance.onerror = settle;
      if (pending === 0) onState('speaking');
      pending += 1;
      speechSynthesis.speak(utterance);
    },
    cancel(): void {
      if (!this.available()) return;
      pending = 0;
      speechSynthesis.cancel();
      onState('idle');
    },
  };
}
