import { useState } from 'react';
import { X } from 'lucide-react';
import type { Widget } from '@catdesk/shared-types';
import { useDashboardStore } from '../dashboardStore';
import { QUICK_ACTION_ICON_NAMES } from './quickActionIcons';
import { QUOTE_FIELDS, type QuoteField } from './metric';

interface Props {
  widget: Widget;
  onClose: () => void;
}

type Update = (id: string, patch: Record<string, unknown>) => void;
type EditorProps = Props & { update: Update };

const FIELD =
  'w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm ' +
  'text-white/90 outline-none placeholder-white/25 focus:border-brand-400/50';
// Les <option> natives s'affichent sinon sur fond blanc (illisible en thème sombre).
const OPTION = 'bg-gray-900 text-white/90';
const LABEL = 'block text-xs font-medium text-white/50';
const SAVE =
  'rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white ' +
  'transition-colors hover:bg-brand-500';
const CANCEL = 'rounded-lg px-3 py-1.5 text-xs text-white/50 transition-colors hover:text-white/80';

function Actions({ onSave, onClose }: { onSave: () => void; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <button className={CANCEL} onClick={onClose}>
        Annuler
      </button>
      <button className={SAVE} onClick={onSave}>
        Enregistrer
      </button>
    </div>
  );
}

/** Éditeur de configuration spécifique au type de widget. */
export function WidgetConfigEditor({ widget, onClose }: Props) {
  const update = useDashboardStore((s) => s.updateWidgetConfig);
  const props: EditorProps = { widget, update, onClose };

  switch (widget.type) {
    case 'quick_action':
      return <QuickActionConfig {...props} />;
    case 'stocks':
      return <StocksConfig {...props} />;
    case 'table':
      return <SymbolsConfig {...props} />;
    case 'chart':
      return <ChartConfig {...props} />;
    case 'kpi':
    case 'stat':
      return <MetricConfigEditor {...props} />;
    default:
      return (
        <p className="py-2 text-center text-xs text-white/30">
          Ce widget n'a pas encore de réglages.
        </p>
      );
  }
}

function QuickActionConfig({ widget, update, onClose }: EditorProps) {
  const [iconName, setIconName] = useState(
    typeof widget.config.iconName === 'string' ? widget.config.iconName : 'zap',
  );
  const [query, setQuery] = useState(
    typeof widget.config.query === 'string' ? widget.config.query : '',
  );

  return (
    <div className="space-y-2.5">
      <label className={LABEL}>
        Icône
        <select
          className={`${FIELD} mt-1`}
          value={iconName}
          onChange={(e) => setIconName(e.target.value)}
        >
          {QUICK_ACTION_ICON_NAMES.map((n) => (
            <option key={n} value={n} className={OPTION}>
              {n}
            </option>
          ))}
        </select>
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
      <Actions
        onClose={onClose}
        onSave={() => {
          update(widget.id, { iconName, query: query.trim() });
          onClose();
        }}
      />
    </div>
  );
}

function MetricConfigEditor({ widget, update, onClose }: EditorProps) {
  const [symbol, setSymbol] = useState(
    typeof widget.config.symbol === 'string' ? widget.config.symbol : '',
  );
  const [field, setField] = useState<QuoteField>(
    (QUOTE_FIELDS as readonly string[]).includes(widget.config.field as string)
      ? (widget.config.field as QuoteField)
      : 'price',
  );
  const [formula, setFormula] = useState(
    typeof widget.config.formula === 'string' ? widget.config.formula : '',
  );
  const [label, setLabel] = useState(
    typeof widget.config.label === 'string' ? widget.config.label : '',
  );

  const save = () => {
    const patch: Record<string, unknown> = { label: label.trim() };
    if (formula.trim().length > 0) {
      patch.formula = formula.trim();
      patch.symbol = '';
    } else {
      patch.symbol = symbol.trim().toUpperCase();
      patch.field = field;
      patch.formula = '';
    }
    update(widget.id, patch);
    onClose();
  };

  return (
    <div className="space-y-2.5">
      <label className={LABEL}>
        Symbole
        <input
          className={`${FIELD} mt-1`}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="AAPL"
        />
      </label>
      <label className={LABEL}>
        Champ
        <select
          className={`${FIELD} mt-1`}
          value={field}
          onChange={(e) => setField(e.target.value as QuoteField)}
        >
          {QUOTE_FIELDS.map((f) => (
            <option key={f} value={f} className={OPTION}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        … ou une formule (prioritaire)
        <input
          className={`${FIELD} mt-1`}
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          placeholder="AAPL.price / MSFT.price"
        />
      </label>
      <label className={LABEL}>
        Libellé (optionnel)
        <input
          className={`${FIELD} mt-1`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="ex. AAPL · prix"
        />
      </label>
      <Actions onClose={onClose} onSave={save} />
    </div>
  );
}

function ChartConfig({ widget, update, onClose }: EditorProps) {
  const [symbol, setSymbol] = useState(
    typeof widget.config.symbol === 'string' ? widget.config.symbol : '',
  );
  return (
    <div className="space-y-2.5">
      <label className={LABEL}>
        Symbole
        <input
          className={`${FIELD} mt-1`}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="AAPL"
        />
      </label>
      <Actions
        onClose={onClose}
        onSave={() => {
          update(widget.id, { symbol: symbol.trim().toUpperCase() });
          onClose();
        }}
      />
    </div>
  );
}

function SymbolsConfig({ widget, update, onClose }: EditorProps) {
  const initial = Array.isArray(widget.config.symbols)
    ? widget.config.symbols.filter((s): s is string => typeof s === 'string').join(', ')
    : '';
  const [text, setText] = useState(initial);
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
      <Actions
        onClose={onClose}
        onSave={() => {
          const symbols = text
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter((s) => s.length > 0);
          update(widget.id, { symbols });
          onClose();
        }}
      />
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

function StocksConfig({ widget, update, onClose }: EditorProps) {
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
              className="shrink-0 rounded p-1 text-white/40 hover:bg-white/10 hover:text-red-300"
              onClick={() => setFormulas((rows) => rows.filter((_, j) => j !== i))}
              aria-label="Retirer la formule"
            >
              <X className="h-3.5 w-3.5" />
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

      <Actions onClose={onClose} onSave={save} />
    </div>
  );
}
