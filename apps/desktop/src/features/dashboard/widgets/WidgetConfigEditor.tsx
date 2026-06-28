import { useState } from 'react';
import type { Widget } from '@catdesk/shared-types';
import { useDashboardStore } from '../dashboardStore';

interface Props {
  widget: Widget;
  onClose: () => void;
}

type Update = (id: string, patch: Record<string, unknown>) => void;

const FIELD =
  'w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm ' +
  'text-white/90 outline-none placeholder-white/25 focus:border-brand-400/50';
const LABEL = 'block text-xs font-medium text-white/50';
const SAVE =
  'rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white ' +
  'transition-colors hover:bg-brand-500';
const CANCEL = 'rounded-lg px-3 py-1.5 text-xs text-white/50 transition-colors hover:text-white/80';

/** Éditeur de configuration spécifique au type de widget. */
export function WidgetConfigEditor({ widget, onClose }: Props) {
  const update = useDashboardStore((s) => s.updateWidgetConfig);

  if (widget.type === 'quick_action') {
    return <QuickActionConfig widget={widget} update={update} onClose={onClose} />;
  }
  if (widget.type === 'stocks') {
    return <StocksConfig widget={widget} update={update} onClose={onClose} />;
  }
  return (
    <p className="py-2 text-center text-xs text-white/30">
      Ce widget n'a pas encore de réglages.
    </p>
  );
}

function QuickActionConfig({ widget, update, onClose }: Props & { update: Update }) {
  const [icon, setIcon] = useState(
    typeof widget.config.icon === 'string' ? widget.config.icon : '',
  );
  const [query, setQuery] = useState(
    typeof widget.config.query === 'string' ? widget.config.query : '',
  );

  return (
    <div className="space-y-2.5">
      <label className={LABEL}>
        Icône
        <input
          className={`${FIELD} mt-1`}
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          placeholder="⚡"
          maxLength={4}
        />
      </label>
      <label className={LABEL}>
        Requête envoyée à l'agent
        <textarea
          className={`${FIELD} mt-1 resize-none`}
          rows={2}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ex. Capture mon écran et décris-le."
        />
      </label>
      <div className="flex justify-end gap-1">
        <button className={CANCEL} onClick={onClose}>
          Annuler
        </button>
        <button
          className={SAVE}
          onClick={() => {
            update(widget.id, { icon: icon.trim() || '⚡', query: query.trim() });
            onClose();
          }}
        >
          Enregistrer
        </button>
      </div>
    </div>
  );
}

interface FormulaRow {
  name: string;
  expression: string;
}

function readFormulas(widget: Widget): FormulaRow[] {
  const fs = widget.config.formulas;
  if (!Array.isArray(fs)) return [];
  const out: FormulaRow[] = [];
  for (const f of fs) {
    if (f !== null && typeof f === 'object') {
      const o = f as { name?: unknown; expression?: unknown };
      if (typeof o.name === 'string' && typeof o.expression === 'string') {
        out.push({ name: o.name, expression: o.expression });
      }
    }
  }
  return out;
}

function StocksConfig({ widget, update, onClose }: Props & { update: Update }) {
  const initialSymbols = Array.isArray(widget.config.symbols)
    ? widget.config.symbols.filter((s): s is string => typeof s === 'string').join(', ')
    : '';
  const [text, setText] = useState(initialSymbols);
  const [formulas, setFormulas] = useState<FormulaRow[]>(readFormulas(widget));

  const updateRow = (i: number, patch: Partial<FormulaRow>) =>
    setFormulas((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = () => {
    const symbols = text
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
    const cleanFormulas = formulas
      .map((f) => ({ name: f.name.trim(), expression: f.expression.trim() }))
      .filter((f) => f.name.length > 0 && f.expression.length > 0);
    update(widget.id, { symbols, formulas: cleanFormulas });
    onClose();
  };

  return (
    <div className="space-y-2.5">
      <label className={LABEL}>
        Symboles (séparés par des virgules)
        <input
          className={`${FIELD} mt-1`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="AAPL, MSFT, TSLA"
        />
      </label>

      <div className="space-y-1.5">
        <span className={LABEL}>Formules (mathjs)</span>
        {formulas.map((f, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              className={`${FIELD} w-1/3`}
              value={f.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
              placeholder="nom"
            />
            <input
              className={`${FIELD} flex-1`}
              value={f.expression}
              onChange={(e) => updateRow(i, { expression: e.target.value })}
              placeholder="AAPL.price / MSFT.price"
            />
            <button
              className="shrink-0 rounded px-1.5 py-1 text-xs text-white/40 hover:bg-white/10 hover:text-red-300"
              onClick={() => setFormulas((rows) => rows.filter((_, j) => j !== i))}
              aria-label="Retirer la formule"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="text-xs text-brand-300 transition-colors hover:text-brand-200"
          onClick={() => setFormulas((rows) => [...rows, { name: '', expression: '' }])}
        >
          + Ajouter une formule
        </button>
      </div>

      <div className="flex justify-end gap-1">
        <button className={CANCEL} onClick={onClose}>
          Annuler
        </button>
        <button className={SAVE} onClick={save}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}
