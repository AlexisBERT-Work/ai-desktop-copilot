import { useDashboardStore } from '../dashboardStore';
import { WIDGET_META } from './widgetMeta';

interface Props {
  onClose: () => void;
}

/** Sélecteur de type de widget à ajouter au tableau de bord. */
export function AddWidgetMenu({ onClose }: Props) {
  const addWidget = useDashboardStore((s) => s.addWidget);

  return (
    <div
      className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/10
                 bg-gray-900/95 p-2 sm:grid-cols-3"
      role="menu"
      aria-label="Ajouter un widget"
    >
      {WIDGET_META.map((m) => (
        <button
          key={m.label}
          role="menuitem"
          onClick={() => {
            addWidget(m.build());
            onClose();
          }}
          className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2 text-left
                     text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white/90"
        >
          <m.Icon className="h-4 w-4 shrink-0 text-brand-300" aria-hidden />
          {m.label}
        </button>
      ))}
    </div>
  );
}
