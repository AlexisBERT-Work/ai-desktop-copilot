import { useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import {
  PRESS_SOURCE_CATALOG,
  PRESS_SOURCE_GROUP_LABEL,
  type PressSourceGroup,
} from '@catdesk/shared-types';
import { fold } from './pressFeedsModel';
import { FIELD } from './pressFeedsUi';

/**
 * Sélecteur de sources intégrées : recherche + pastilles par famille. Les ids
 * inconnus du catalogue (sources retirées) restent listés pour être retirables.
 */
export function SourcePicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const q = fold(query.trim());

  const groups = useMemo(() => {
    const matches = PRESS_SOURCE_CATALOG.filter(
      s => q === '' || fold(s.label).includes(q) || fold(s.id).includes(q),
    );
    const byGroup = new Map<PressSourceGroup, typeof matches>();
    for (const s of matches) {
      const g = byGroup.get(s.group) ?? [];
      g.push(s);
      byGroup.set(s.group, g);
    }
    return byGroup;
  }, [q]);

  const known = new Set(PRESS_SOURCE_CATALOG.map(s => s.id));
  const unknown = selected.filter(id => !known.has(id));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
        <input
          className={`${FIELD} pl-8`}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Rechercher une source (Le Monde, CNBC, Numerama…)"
        />
      </div>
      <div className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1">
        {[...groups.entries()].map(([group, sources]) => (
          <div key={group}>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">
              {PRESS_SOURCE_GROUP_LABEL[group]}
            </p>
            <div className="flex flex-wrap gap-1">
              {sources.map(s => {
                const on = selected.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggle(s.id)}
                    aria-pressed={on}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all active:scale-90 ${
                      on
                        ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
                        : 'bg-white/5 text-white/55 hover:bg-white/10 hover:text-white/85'
                    }`}
                  >
                    {s.label}
                    <span
                      className={`ml-1 text-[9px] uppercase ${on ? 'text-white/60' : 'text-white/30'}`}
                    >
                      {s.lang}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {groups.size === 0 && (
          <p className="text-xs text-white/30">Aucune source pour « {query.trim()} ».</p>
        )}
        {unknown.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {unknown.map(id => (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className="flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-1 text-xs text-red-300 transition-all hover:bg-red-500/25 active:scale-90"
                title="Source inconnue du catalogue — cliquer pour retirer"
              >
                {id}
                <Trash2 className="h-3 w-3" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
