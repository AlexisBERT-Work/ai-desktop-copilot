import { useEffect, useState } from 'react';
import { ArrowUp, Check, Copy, Loader2, Wand2, X } from 'lucide-react';
import { useOverlayStore } from '../overlay/overlayStore';
import { useChatStore } from '../chat/store/chatStore';
import { SELECTION_PRESETS, useSelectionStore } from './selectionStore';

/** Après « Texte remplacé », la bulle se referme d'elle-même. */
const CLOSE_AFTER_DONE_MS = 1_400;

const CHIP =
  'px-2.5 py-1 rounded-full text-xs text-white/75 bg-white/6 border border-white/10 ' +
  'hover:bg-white/12 hover:text-white disabled:opacity-40 transition-colors';
const BTN =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ' +
  'disabled:opacity-40';

function TextBlock({ label, text, muted }: { label: string; text: string; muted?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-white/40 uppercase tracking-wider mb-1">{label}</p>
      <div
        className={`max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border px-3 py-2 text-sm
          ${muted ? 'border-white/6 bg-white/2 text-white/45' : 'border-brand-500/30 bg-brand-500/5 text-white/90'}`}
      >
        {text}
      </div>
    </div>
  );
}

/**
 * Bulle « Transformer la sélection » (Ctrl+Alt+T) : consigne, avant/après,
 * Entrée remplace. Le texte n'est jamais collé sans cette validation.
 */
export function SelectionPanel() {
  const phase = useSelectionStore(s => s.phase);
  const original = useSelectionStore(s => s.original);
  const result = useSelectionStore(s => s.result);
  const instruction = useSelectionStore(s => s.instruction);
  const notice = useSelectionStore(s => s.notice);
  const transform = useSelectionStore(s => s.transform);
  const replace = useSelectionStore(s => s.replace);
  const editInstruction = useSelectionStore(s => s.editInstruction);
  const hide = useOverlayStore(s => s.hide);
  const model = useChatStore(s => s.selectedModel);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (phase !== 'done') return;
    const timer = setTimeout(hide, CLOSE_AFTER_DONE_MS);
    return () => clearTimeout(timer);
  }, [phase, hide]);

  const submit = (text: string) => {
    if (text.trim() === '') return;
    void transform(text, model);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const chars = [...original].length;

  return (
    <div
      className="w-[620px] rounded-2xl border border-white/10 bg-gray-950/96 shadow-2xl shadow-black/60
                 backdrop-blur-2xl ring-1 ring-white/5 p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-brand-400" aria-hidden />
        <p className="text-sm font-medium text-white/90">Transformer la sélection</p>
        {chars > 0 && (
          <span className="text-xs text-white/35">
            · {chars.toLocaleString('fr-FR')} caractère{chars > 1 ? 's' : ''}
          </span>
        )}
        <button
          onClick={hide}
          aria-label="Fermer"
          className="ml-auto p-1 rounded-md text-white/40 hover:text-white hover:bg-white/8"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {phase === 'instruction' && (
        <>
          <TextBlock label="Texte sélectionné" text={original} muted />
          <div className="flex flex-wrap gap-1.5">
            {SELECTION_PRESETS.map(p => (
              <button key={p.label} className={CHIP} onClick={() => submit(p.instruction)}>
                {p.label}
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={e => {
              e.preventDefault();
              submit(draft);
            }}
          >
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              maxLength={300}
              placeholder="Ou une consigne : « traduis en espagnol », « en trois puces »…"
              aria-label="Consigne"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white
                         placeholder:text-white/30 focus:outline-none focus:border-brand-500/50"
            />
            <button
              type="submit"
              disabled={draft.trim() === ''}
              aria-label="Transformer"
              className={`${BTN} bg-brand-500 text-white hover:bg-brand-400`}
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          </form>
        </>
      )}

      {phase === 'working' && (
        <>
          <TextBlock label="Texte sélectionné" text={original} muted />
          <p className="flex items-center gap-2 text-sm text-white/70">
            <Loader2 className="w-4 h-4 animate-spin text-brand-400" aria-hidden />
            Transformation… <span className="text-white/40 truncate">« {instruction} »</span>
          </p>
          <p className="text-xs text-white/30">Échap pour annuler.</p>
        </>
      )}

      {(phase === 'review' || phase === 'replacing') && (
        <>
          <TextBlock label="Avant" text={original} muted />
          <TextBlock label="Après" text={result} />
          <div className="flex items-center gap-2">
            <button
              autoFocus
              disabled={phase === 'replacing'}
              onClick={() => void replace()}
              className={`${BTN} bg-brand-500 text-white hover:bg-brand-400`}
            >
              {phase === 'replacing' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="w-3.5 h-3.5" aria-hidden />
              )}
              Remplacer <kbd className="text-white/60">⏎</kbd>
            </button>
            <button
              onClick={() => void copy()}
              className={`${BTN} text-white/70 bg-white/6 hover:bg-white/12`}
            >
              <Copy className="w-3.5 h-3.5" aria-hidden />
              {copied ? 'Copié' : 'Copier'}
            </button>
            <button
              onClick={editInstruction}
              disabled={phase === 'replacing'}
              className={`${BTN} text-white/70 bg-white/6 hover:bg-white/12`}
            >
              Autre consigne
            </button>
          </div>
        </>
      )}

      {phase === 'done' && (
        <p className="flex items-center gap-2 text-sm text-emerald-300">
          <Check className="w-4 h-4" aria-hidden />
          {notice}
        </p>
      )}

      {notice !== null && phase !== 'done' && (
        <p role="alert" className="text-xs text-amber-300/90">
          {notice}
        </p>
      )}
    </div>
  );
}
