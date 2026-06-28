import type { ComponentType } from 'react';
import type { WidgetType } from '@catdesk/shared-types';
import type { WidgetProps } from './types';
import { QuickActionWidget } from './QuickActionWidget';
import { StocksWidget } from './StocksWidget';
import { NewsWidget } from './NewsWidget';
import { PlaceholderWidget } from './PlaceholderWidget';

/** Associe chaque type de widget à son composant de rendu. */
const REGISTRY: Record<WidgetType, ComponentType<WidgetProps>> = {
  quick_action: QuickActionWidget,
  stocks: StocksWidget,
  news: NewsWidget,
  kpi: PlaceholderWidget,
  stat: PlaceholderWidget,
  chart: PlaceholderWidget,
  table: PlaceholderWidget,
};

export function widgetComponent(type: WidgetType): ComponentType<WidgetProps> {
  return REGISTRY[type];
}
