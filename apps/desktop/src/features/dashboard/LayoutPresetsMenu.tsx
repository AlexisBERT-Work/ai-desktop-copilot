import { useState } from 'react';
import { Bookmark, Check, RotateCcw, Trash2 } from 'lucide-react';
import { useDashboardStore } from './dashboardStore';

interface Props {
  onClose: () => void;
}

/**
 * Gestion des affichages enregistrés : sauvegarder la disposition actuelle du
 * canvas sous un nom, restaurer n'importe quel affichage d'un clic, ou revenir
 * à la disposition par défaut. Permet d'alterner entre plusieurs mises en page
 * (ex. « Bourse », « Presse », « Grand écran »).
 */
export function LayoutPresetsMenu({ onClose }: Props) {
  const presets = useDashboardStore(s => s.presets);
  const savePreset = useDashboardStore(s => s.savePreset);
  const applyPreset = useDashboardStore(s => s.applyPreset);
  const deletePreset = useDashboardStore(s => s.deletePreset);
  const resetToDefault = useDashboardStore(s => s.resetToDefault);
  const [name, setName] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmDefault, setConfirmDefault] = useState(false);

  const save = () => {
    savePreset(name);
    setName('');
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1200);
  };

  return (
    <div
      className="space-y-2 rounded-xl border border-white/10 bg-gray-900/95 p-2"
      role="menu"
      aria-label="Affichages enregistrés"
    >
      {/* Enregistrer la disposition actuelle */}
      <div className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') save();
          }}
          placeholder={`Nom de l'affichage (ex. « Bourse ») — défaut : Affichage ${presets.length + 1}`}
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5
                     text-xs text-white/90 placeholder:text-white/25 outline-none
                     focus:border-brand-400/50"
          aria-label="Nom du nouvel affichage"
        />
        <button
          onClick={save}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5
                     text-xs text-white transition-colors hover:bg-brand-500"
        >
          {savedFlash ? <Check className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
          {savedFlash ? 'Enregistré' : 'Enregistrer l’affichage actuel'}
        </button>
      </div>

      {/* Affichages enregistrés */}
      {presets.length > 0 && (
        <div>
          <p className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/30">
            Restaurer un affichage
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {presets.map(p => (
              <div
                key={p.id}
                className="flex items-center gap-1 rounded-lg bg-white/5 pr-1 transition-colors
                           hover:bg-white/10"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    applyPreset(p.id);
                    onClose();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-xs
                             text-white/70 hover:text-white/90"
                  title={`Restaurer « ${p.name} » (${p.widgets.length} widgets)`}
                >
                  <Bookmark className="h-4 w-4 shrink-0 text-brand-300" aria-hidden />
                  <span className="truncate">{p.name}</span>
                </button>
                <button
                  onClick={() => deletePreset(p.id)}
                  className="shrink-0 rounded p-1 text-white/25 transition-colors
                             hover:bg-red-500/15 hover:text-red-300"
                  aria-label={`Supprimer l'affichage ${p.name}`}
                  title="Supprimer cet affichage"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disposition par défaut (2 clics : remplace la disposition actuelle) */}
      <button
        onClick={() => {
          if (confirmDefault) {
            resetToDefault();
            setConfirmDefault(false);
            onClose();
          } else {
            setConfirmDefault(true);
          }
        }}
        onBlur={() => setConfirmDefault(false)}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
          confirmDefault
            ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30'
            : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80'
        }`}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {confirmDefault
          ? 'Confirmer ? (la disposition actuelle sera remplacée)'
          : 'Disposition par défaut'}
      </button>
    </div>
  );
}
