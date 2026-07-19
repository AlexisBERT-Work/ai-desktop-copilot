import { useState } from 'react';
import { X } from 'lucide-react';
import {
  DAILY_KIND_FILTER_LABEL,
  WIDGET_ACCENTS,
  type DailyKindFilter,
  type Widget,
} from '@catdesk/shared-types';
import { useDashboardStore } from '../dashboardStore';
import { QUICK_ACTION_ICON_NAMES } from './quickActionIcons';
import { QUOTE_FIELDS, type QuoteField } from './metric';
import { ACCENT_LABEL, ACCENT_STYLES, readWidgetStyle, TEXT_SCALES } from './widgetStyle';

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

/** Éditeur de configuration : style commun (couleur, texte) + réglages du type. */
export function WidgetConfigEditor({ widget, onClose }: Props) {
  const update = useDashboardStore(s => s.updateWidgetConfig);
  const props: EditorProps = { widget, update, onClose };

  const typeEditor = (() => {
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
      case 'dailies':
        return <DailiesConfig {...props} />;
      default:
        return (
          <p className="py-2 text-center text-xs text-white/30">
            Ce widget n'a pas d'autres réglages.
          </p>
        );
    }
  })();

  return (
    <div className="space-y-2.5">
      <StyleSection widget={widget} />
      <div className="border-t border-white/10 pt-2.5">{typeEditor}</div>
    </div>
  );
}

/**
 * Personnalisation visuelle commune à tous les widgets : couleur d'accent et
 * taille du texte. Application IMMÉDIATE (aperçu en direct sur la carte) —
 * pas de bouton Enregistrer, contrairement aux réglages du type.
 */
function StyleSection({ widget }: { widget: Widget }) {
  const setWidgetStyle = useDashboardStore(s => s.setWidgetStyle);
  const { accent, textScale } = readWidgetStyle(widget);

  return (
    <div className="space-y-2">
      <div>
        <span className={LABEL}>Couleur</span>
        <div className="mt-1 flex items-center gap-1.5">
          {WIDGET_ACCENTS.map(a => (
            <button
              key={a}
              onClick={() => setWidgetStyle(widget.id, { accent: a })}
              aria-label={`Couleur ${ACCENT_LABEL[a]}`}
              aria-pressed={accent === a}
              title={ACCENT_LABEL[a]}
              className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${ACCENT_STYLES[a].swatch} ${
                accent === a ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-gray-900' : ''
              }`}
            />
          ))}
        </div>
      </div>
      <div>
        <span className={LABEL}>Taille du texte</span>
        <div className="mt-1 flex w-fit gap-0.5 rounded-lg bg-white/5 p-0.5">
          {TEXT_SCALES.map(t => (
            <button
              key={t.value}
              onClick={() => setWidgetStyle(widget.id, { textScale: t.value })}
              aria-pressed={textScale === t.value}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                textScale === t.value
                  ? 'bg-white/15 text-white'
                  : 'text-white/45 hover:text-white/80'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
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
          onChange={e => setIconName(e.target.value)}
        >
          {QUICK_ACTION_ICON_NAMES.map(n => (
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
          onChange={e => setQuery(e.target.value)}
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

const KIND_OPTIONS: readonly DailyKindFilter[] = ['all', 'journal', 'topic'];

function DailiesConfig({ widget, update, onClose }: EditorProps) {
  const initial = widget.config.kind;
  const [kind, setKind] = useState<DailyKindFilter>(
    initial === 'journal' || initial === 'topic' ? initial : 'all',
  );
  return (
    <div className="space-y-2.5">
      <label className={LABEL}>
        Affichage
        <select
          className={`${FIELD} mt-1`}
          value={kind}
          onChange={e => setKind(e.target.value as DailyKindFilter)}
        >
          {KIND_OPTIONS.map(k => (
            <option key={k} value={k} className={OPTION}>
              {DAILY_KIND_FILTER_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <Actions
        onClose={onClose}
        onSave={() => {
          update(widget.id, { kind });
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
          onChange={e => setSymbol(e.target.value)}
          placeholder="AAPL"
        />
      </label>
      <label className={LABEL}>
        Champ
        <select
          className={`${FIELD} mt-1`}
          value={field}
          onChange={e => setField(e.target.value as QuoteField)}
        >
          {QUOTE_FIELDS.map(f => (
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
          onChange={e => setFormula(e.target.value)}
          placeholder="AAPL.price / MSFT.price"
        />
      </label>
      <label className={LABEL}>
        Libellé (optionnel)
        <input
          className={`${FIELD} mt-1`}
          value={label}
          onChange={e => setLabel(e.target.value)}
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
          onChange={e => setSymbol(e.target.value)}
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
          onChange={e => setText(e.target.value)}
          placeholder="AAPL, MSFT, TSLA"
        />
      </label>
      <Actions
        onClose={onClose}
        onSave={() => {
          const symbols = text
            .split(',')
            .map(s => s.trim().toUpperCase())
            .filter(s => s.length > 0);
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
    setFormulas(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = () => {
    const symbols = text
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0);
    const cleanFormulas = formulas
      .map(f => ({ name: f.name.trim(), expression: f.expression.trim() }))
      .filter(f => f.name.length > 0 && f.expression.length > 0);
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
          onChange={e => setText(e.target.value)}
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
              onChange={e => updateRow(i, { name: e.target.value })}
              placeholder="nom"
            />
            <input
              className={`${FIELD} flex-1`}
              value={f.expression}
              onChange={e => updateRow(i, { expression: e.target.value })}
              placeholder="AAPL.price / MSFT.price"
            />
            <button
              className="shrink-0 rounded p-1 text-white/40 hover:bg-white/10 hover:text-red-300"
              onClick={() => setFormulas(rows => rows.filter((_, j) => j !== i))}
              aria-label="Retirer la formule"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          className="text-xs text-brand-300 transition-colors hover:text-brand-200"
          onClick={() => setFormulas(rows => [...rows, { name: '', expression: '' }])}
        >
          + Ajouter une formule
        </button>
      </div>

      <Actions onClose={onClose} onSave={save} />
    </div>
  );
}
