import { Toggle } from '../../shared/ui/Toggle';
import { useSettingsStore } from './settingsStore';

/**
 * Onglet Raccourcis : les raccourcis globaux et locaux, et l'interrupteur de
 * « transformer la sélection » (Ctrl+Alt+T), désactivé par défaut.
 */
export function HotkeysTab() {
  const selection = useSettingsStore(s => s.selectionTransform);
  const selectionHint = useSettingsStore(s => s.selectionHint);
  const setSelection = useSettingsStore(s => s.setSelectionTransform);
  const global = [
    { keys: 'Ctrl+Space', action: 'Ouvrir / fermer CatDesk' },
    ...(selection ? [{ keys: 'Ctrl+Alt+T', action: 'Transformer le texte sélectionné' }] : []),
  ];
  const local = [
    { keys: 'Ctrl+K', action: 'Palette de commandes' },
    { keys: 'Ctrl+,', action: 'Ouvrir les paramètres' },
    { keys: 'Ctrl+N', action: 'Nouvelle conversation' },
    { keys: 'Escape', action: "Fermer l'overlay" },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Toggle
          label="Transformer le texte sélectionné (Ctrl+Alt+T)"
          description="Sélectionnez du texte dans n'importe quelle application, Ctrl+Alt+T, puis une consigne (corriger, traduire, raccourcir…) : CatDesk montre l'avant/après, et Entrée remplace la sélection. Le presse-papiers est remis tel quel ; rien n'est collé sans votre validation."
          checked={selection}
          onChange={on => void setSelection(on)}
        />
        {selectionHint !== null && (
          <p role="alert" className="text-xs text-amber-300/90 px-1">
            {selectionHint}
          </p>
        )}
      </div>

      <div>
        <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
          Global (OS)
        </p>
        <div className="space-y-1">
          {global.map(({ keys, action }) => (
            <div
              key={keys}
              className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/3"
            >
              <span className="text-sm text-white/70">{action}</span>
              <Keybind keys={keys} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
          Dans l'interface
        </p>
        <div className="space-y-1">
          {local.map(({ keys, action }) => (
            <div
              key={keys}
              className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/3"
            >
              <span className="text-sm text-white/70">{action}</span>
              <Keybind keys={keys} />
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-white/25">
        La personnalisation des raccourcis sera disponible dans une prochaine version.
      </p>
    </div>
  );
}

function Keybind({ keys }: { keys: string }) {
  return (
    <div className="flex items-center gap-1">
      {keys.split('+').map((k, i) => (
        <kbd
          key={i}
          className="px-1.5 py-0.5 text-[11px] font-medium text-white/50 bg-white/8 border border-white/10 rounded"
        >
          {k}
        </kbd>
      ))}
    </div>
  );
}
