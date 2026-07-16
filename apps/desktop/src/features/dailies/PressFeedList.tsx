import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { DAILY_CATEGORY_LABEL, type PressFeed } from '@catdesk/shared-types';
import { sourceSummary } from './pressFeedsModel';

/**
 * Liste des journaux personnalisés avec édition et suppression (confirmation
 * en deux clics, annulée à la perte de focus). La suppression effective est
 * déléguée au parent via `onRemove`.
 */
export function PressFeedList({
  items,
  busy,
  onEdit,
  onRemove,
}: {
  items: PressFeed[];
  busy: boolean;
  onEdit: (feed: PressFeed) => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const remove = async (id: string) => {
    await onRemove(id);
    setConfirmId(null);
  };

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-white/90">
        Journaux personnalisés <span className="text-white/40">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-white/35">Aucun journal personnalisé pour l'instant.</p>
      ) : (
        <ul className="space-y-2">
          {items.map(f => {
            return (
              <li
                key={f.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors
                           hover:border-brand-400/30 hover:bg-white/[0.05]"
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded bg-brand-600/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-200">
                    {DAILY_CATEGORY_LABEL[f.category]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/85">
                    {f.name}
                  </span>
                  {!f.enabled && (
                    <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/40">
                      inactif
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-white/40">
                  {sourceSummary(f)}
                  {f.includeKeywords.length > 0 && ` · mots-clés : ${f.includeKeywords.join(', ')}`}
                  {f.includeRegex !== null && ` · regex+`}
                  {f.excludeRegex !== null && ` · regex−`}
                </p>
                <div className="mt-2 flex items-center gap-1">
                  <button
                    onClick={() => onEdit(f)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-white/55 hover:bg-white/10 hover:text-white/85"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Éditer
                  </button>
                  <button
                    onClick={() => (confirmId === f.id ? void remove(f.id) : setConfirmId(f.id))}
                    onBlur={() => setConfirmId(id => (id === f.id ? null : id))}
                    disabled={busy}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                      confirmId === f.id
                        ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30'
                        : 'text-white/55 hover:bg-white/10 hover:text-red-300'
                    }`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {confirmId === f.id ? 'Confirmer ?' : 'Supprimer'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
