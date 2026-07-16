/** Onglet Raccourcis : liste en lecture seule des raccourcis globaux et locaux. */
export function HotkeysTab() {
  const global = [{ keys: 'Ctrl+Space', action: 'Ouvrir / fermer CatDesk' }];
  const local = [
    { keys: 'Ctrl+K', action: 'Palette de commandes' },
    { keys: 'Ctrl+,', action: 'Ouvrir les paramètres' },
    { keys: 'Ctrl+N', action: 'Nouvelle conversation' },
    { keys: 'Escape', action: "Fermer l'overlay" },
  ];

  return (
    <div className="space-y-6">
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
