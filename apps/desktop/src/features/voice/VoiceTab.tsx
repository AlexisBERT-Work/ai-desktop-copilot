import { Mic, Volume2 } from 'lucide-react';
import { BTN_GHOST_SM, FIELD, LABEL, OPTION } from '../../shared/ui/tokens';
import { useVoiceStore } from './voiceStore';

/** Nom lisible d'un dossier Piper : `vits-piper-fr_FR-miro-high` → « miro (high) ». */
function voiceLabel(dir: string): string {
  const m = /^vits-piper-([a-z]{2}_[A-Z]{2})-(.+)-(low|medium|high)$/.exec(dir);
  if (!m) return dir;
  return `${m[2]} (${m[3]}, ${m[1]})`;
}

interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}

function Toggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  return (
    <div className="flex items-start gap-4 p-3 rounded-xl border bg-white/3 border-white/8">
      <div className="flex-1">
        <p className="text-sm font-medium text-white/90">{label}</p>
        <p className="text-xs text-white/45 mt-0.5">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 w-10 h-5 rounded-full transition-colors focus:outline-none shrink-0
          disabled:opacity-40 ${checked ? 'bg-brand-500' : 'bg-white/15'}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
            ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </button>
    </div>
  );
}

/** Onglet Voix : activer, écouter, lire, choisir la voix — et voir ce qui manque. */
export function VoiceTab() {
  const enabled = useVoiceStore(s => s.enabled);
  const readAloud = useVoiceStore(s => s.readAloud);
  const autoListen = useVoiceStore(s => s.autoListenOnOverlay);
  const continueAfter = useVoiceStore(s => s.continueAfterAnswer);
  const voice = useVoiceStore(s => s.voice);
  const speed = useVoiceStore(s => s.speed);
  const status = useVoiceStore(s => s.status);
  const hint = useVoiceStore(s => s.hint);
  const setEnabled = useVoiceStore(s => s.setEnabled);
  const setReadAloud = useVoiceStore(s => s.setReadAloud);
  const setAutoListen = useVoiceStore(s => s.setAutoListenOnOverlay);
  const setContinue = useVoiceStore(s => s.setContinueAfterAnswer);
  const setVoice = useVoiceStore(s => s.setVoice);
  const setSpeed = useVoiceStore(s => s.setSpeed);
  const testVoice = useVoiceStore(s => s.testVoice);
  const listen = useVoiceStore(s => s.listen);

  const voices = status?.voices ?? [];
  const stt = status?.sttAvailable ?? false;
  const tts = status?.ttsAvailable ?? false;

  return (
    <div className="space-y-4">
      <Toggle
        label="Parler à CatDesk"
        description="Tout se passe sur cette machine, sur le processeur : rien ne sort, et la carte graphique reste au modèle de chat."
        checked={enabled}
        onChange={setEnabled}
      />

      {/* État des moteurs */}
      <div className="rounded-xl border border-white/8 bg-white/3 p-3 text-xs space-y-1.5">
        <p className="font-medium text-white/50 uppercase tracking-wider">Moteurs</p>
        <StatusLine
          ok={stt}
          label="Reconnaissance"
          detail={stt ? 'Parakeet TDT 0.6B v3 + VAD Silero' : 'modèles absents — micro désactivé'}
        />
        <StatusLine
          ok={tts}
          label="Synthèse"
          detail={tts ? `Piper — ${voiceLabel(voice)}` : 'Piper absent — voix Windows en secours'}
        />
        <p className="text-white/35 pt-1 break-all">
          Dossier des modèles :{' '}
          {status?.modelsDir ?? 'introuvable (resources/voice ou %APPDATA%\\CatDesk\\data\\voice)'}
        </p>
        {hint && <p className="text-orange-300/90 pt-1">{hint}</p>}
      </div>

      <Toggle
        label="Ctrl+Espace ouvre aussi le micro"
        description="La bulle s'ouvre et écoute tout de suite ; Échap la referme et coupe le micro."
        checked={autoListen}
        onChange={setAutoListen}
        disabled={!enabled}
      />
      <Toggle
        label="Lire les réponses à voix haute"
        description="Phrase par phrase, dès qu'elle est écrite — sans attendre la fin de la réponse."
        checked={readAloud}
        onChange={setReadAloud}
        disabled={!enabled}
      />
      <Toggle
        label="Réécouter après une réponse orale"
        description="Après avoir répondu à une question posée au micro, CatDesk réouvre le micro pour la suite (8 s de silence = fin)."
        checked={continueAfter}
        onChange={setContinue}
        disabled={!enabled}
      />

      {/* Voix et vitesse */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL} htmlFor="voice-select">
            Voix
          </label>
          <select
            id="voice-select"
            className={FIELD}
            value={voice}
            disabled={!enabled || voices.length === 0}
            onChange={e => setVoice(e.target.value)}
          >
            {voices.length === 0 && (
              <option className={OPTION} value={voice}>
                {tts ? voiceLabel(voice) : 'voix Windows (secours)'}
              </option>
            )}
            {voices.map(v => (
              <option key={v} className={OPTION} value={v}>
                {voiceLabel(v)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="voice-speed">
            Vitesse ×{speed.toFixed(2)}
          </label>
          <input
            id="voice-speed"
            type="range"
            min={0.7}
            max={1.5}
            step={0.05}
            value={speed}
            disabled={!enabled}
            onChange={e => setSpeed(Number(e.target.value))}
            className="w-full accent-brand-500 mt-2"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" className={BTN_GHOST_SM} disabled={!enabled} onClick={testVoice}>
          <Volume2 className="w-3.5 h-3.5 inline mr-1.5" />
          Tester la voix
        </button>
        <button
          type="button"
          className={BTN_GHOST_SM}
          disabled={!enabled || !stt}
          onClick={() => void listen()}
        >
          <Mic className="w-3.5 h-3.5 inline mr-1.5" />
          Tester le micro
        </button>
      </div>
    </div>
  );
}

function StatusLine({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <p className="flex items-center gap-2 text-white/70">
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-400' : 'bg-orange-400'}`} />
      <span className="font-medium">{label}</span>
      <span className="text-white/45">{detail}</span>
    </p>
  );
}
