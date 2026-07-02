import {
  Camera,
  Clipboard,
  Terminal,
  FileText,
  Search,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** Icônes disponibles pour les widgets « action rapide » (par nom). */
export const QUICK_ACTION_ICONS: Record<string, LucideIcon> = {
  zap: Zap,
  camera: Camera,
  clipboard: Clipboard,
  terminal: Terminal,
  file: FileText,
  search: Search,
};

export const QUICK_ACTION_ICON_NAMES = Object.keys(QUICK_ACTION_ICONS);

export function quickActionIcon(name: unknown): LucideIcon {
  if (typeof name === 'string') {
    const icon = QUICK_ACTION_ICONS[name];
    if (icon !== undefined) return icon;
  }
  return Zap;
}
