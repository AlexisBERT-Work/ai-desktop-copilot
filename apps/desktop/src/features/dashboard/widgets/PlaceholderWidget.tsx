import type { WidgetProps } from './types';

/** Rendu par défaut pour les types de widget pas encore implémentés. */
export function PlaceholderWidget({ widget }: WidgetProps) {
  return (
    <div
      className="flex h-full min-h-[60px] items-center justify-center rounded-lg
                 border border-dashed border-white/10 text-xs text-white/30"
    >
      Widget « {widget.type} » — bientôt
    </div>
  );
}
