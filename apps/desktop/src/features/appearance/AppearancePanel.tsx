import type { ReactNode } from 'react';
import { Monitor, MessageSquare, Database, RotateCcw, Palette } from 'lucide-react';
import {
  ACCENT_LABELS,
  ACCENT_NAMES,
  ACCENT_PALETTES,
  BUBBLE_DIMENSIONS,
  BUBBLE_SIZES,
  CORNER_LABELS,
  CORNER_NAMES,
  DENSITIES,
  DENSITY_NAMES,
  isCornerName,
  SURFACE_NAMES,
  SURFACES,
} from './palettes';
import {
  CURRENCIES,
  FONT_SCALES,
  LOCALE_LABELS,
  NUMBER_LOCALES,
  REFRESH_CHOICES,
  useAppearanceStore,
  type CurrencyCode,
  type NumberLocale,
} from './appearanceStore';

/** Une ligne « intitulé + explication à gauche, contrôle à droite ». */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-white/80">{label}</p>
        {hint !== undefined && <p className="mt-0.5 text-xs text-white/35">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Group({
  Icon,
  title,
  children,
}: {
  Icon: typeof Palette;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/45">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h3>
      <div className="mt-1 divide-y divide-white/5">{children}</div>
    </section>
  );
}

/** Sélecteur segmenté générique — l'option active est mise en relief. */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex gap-0.5 rounded-lg bg-white/5 p-0.5">
      {options.map(o => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            value === o.value ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white/75'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`h-5 w-9 rounded-full p-0.5 transition-colors ${
        checked ? 'bg-brand-600' : 'bg-white/15'
      }`}
    >
      <span
        className={`block h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

const SELECT =
  'rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/85 outline-none ' +
  'focus:border-brand-400/50';
const OPTION = 'bg-gray-900 text-white/90';

/**
 * Panneau de personnalisation, partagé par la fenêtre Réglages (onglet
 * « Apparence ») et la fenêtre Marchés & News (bouton « Apparence »). Tout
 * s'applique IMMÉDIATEMENT et dans les deux fenêtres : aucun bouton
 * « Enregistrer », le store est persisté et propagé via l'événement `storage`.
 */
export function AppearancePanel() {
  const a = useAppearanceStore();
  const set = useAppearanceStore(s => s.set);
  const reset = useAppearanceStore(s => s.reset);

  return (
    <div className="space-y-3">
      <Group Icon={Palette} title="Apparence">
        <Row label="Couleur d'accent" hint="Repeint boutons, liens et sélections dans toute l'app.">
          <div className="flex items-center gap-1.5">
            {ACCENT_NAMES.map(name => (
              <button
                key={name}
                onClick={() => set({ accent: name })}
                aria-label={ACCENT_LABELS[name]}
                aria-pressed={a.accent === name}
                title={ACCENT_LABELS[name]}
                style={{ backgroundColor: ACCENT_PALETTES[name][500] }}
                className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                  a.accent === name ? 'ring-2 ring-white/70 ring-offset-2 ring-offset-gray-950' : ''
                }`}
              />
            ))}
          </div>
        </Row>

        <Row label="Fond" hint="Fond du tableau de bord et remplissage par défaut des cartes.">
          <div className="flex items-center gap-1.5">
            {SURFACE_NAMES.map(name => (
              <button
                key={name}
                onClick={() => set({ surface: name })}
                aria-label={SURFACES[name].label}
                aria-pressed={a.surface === name}
                title={SURFACES[name].label}
                className={`h-6 w-9 overflow-hidden rounded-md border transition-transform hover:scale-105 ${
                  a.surface === name ? 'border-white/70' : 'border-white/15'
                }`}
                style={{ background: SURFACES[name].page }}
              >
                <span
                  className="mx-auto mt-1.5 block h-3 w-6 rounded-sm"
                  style={{ background: SURFACES[name].card }}
                />
              </button>
            ))}
          </div>
        </Row>

        <Row label="Densité" hint="Espace intérieur des cartes.">
          <Segmented
            ariaLabel="Densité"
            value={a.density}
            onChange={v => set({ density: v })}
            options={DENSITY_NAMES.map(d => ({ value: d, label: DENSITIES[d].label }))}
          />
        </Row>

        <Row label="Taille du texte" hint="Fenêtre Marchés & News. La bulle se règle plus bas.">
          <Segmented
            ariaLabel="Taille du texte"
            value={a.fontScale}
            onChange={v => set({ fontScale: v })}
            options={FONT_SCALES.map(f => ({ value: f.value, label: f.label }))}
          />
        </Row>

        <Row label="Animations" hint="Entrées de cartes et transitions.">
          <Toggle
            ariaLabel="Animations"
            checked={a.animations}
            onChange={v => set({ animations: v })}
          />
        </Row>
      </Group>

      <Group Icon={MessageSquare} title="Bulle de chat">
        <Row label="Taille" hint="Gabarit de la bulle et de la fenêtre de chat.">
          <Segmented
            ariaLabel="Taille de la bulle"
            value={a.bubbleSize}
            onChange={v => set({ bubbleSize: v })}
            options={BUBBLE_SIZES.map(b => ({ value: b, label: BUBBLE_DIMENSIONS[b].label }))}
          />
        </Row>

        <Row label="Position à l'écran">
          <select
            className={SELECT}
            value={a.corner}
            onChange={e => {
              if (isCornerName(e.target.value)) set({ corner: e.target.value });
            }}
            aria-label="Position de la bulle"
          >
            {CORNER_NAMES.map(c => (
              <option key={c} value={c} className={OPTION}>
                {CORNER_LABELS[c]}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Opacité du fond" hint={`${Math.round(a.bubbleOpacity * 100)} %`}>
          <input
            type="range"
            min={60}
            max={100}
            step={2}
            value={Math.round(a.bubbleOpacity * 100)}
            onChange={e => set({ bubbleOpacity: Number(e.target.value) / 100 })}
            className="h-1 w-28 cursor-pointer accent-brand-500"
            aria-label="Opacité du fond de la bulle"
          />
        </Row>

        <Row label="À l'ouverture" hint="Panneau affiché quand la bulle est invoquée.">
          <Segmented
            ariaLabel="Panneau à l'ouverture"
            value={a.launchMode}
            onChange={v => set({ launchMode: v })}
            options={[
              { value: 'mini' as const, label: 'Barre' },
              { value: 'chat' as const, label: 'Chat' },
            ]}
          />
        </Row>
      </Group>

      <Group Icon={Database} title="Contenu & données">
        <Row label="Rafraîchissement des cours" hint="Fréquence d'interrogation du marché.">
          <Segmented
            ariaLabel="Rafraîchissement"
            value={a.refreshSeconds}
            onChange={v => set({ refreshSeconds: v })}
            options={REFRESH_CHOICES.map(r => ({ value: r.seconds, label: r.label }))}
          />
        </Row>

        <Row label="Format des nombres">
          <select
            className={SELECT}
            value={a.numberLocale}
            onChange={e => set({ numberLocale: e.target.value as NumberLocale })}
            aria-label="Format des nombres"
          >
            {NUMBER_LOCALES.map(l => (
              <option key={l} value={l} className={OPTION}>
                {LOCALE_LABELS[l]}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Devise" hint="Symbole ajouté aux prix.">
          <select
            className={SELECT}
            value={a.currency}
            onChange={e => set({ currency: e.target.value as CurrencyCode })}
            aria-label="Devise"
          >
            {CURRENCIES.map(c => (
              <option key={c} value={c} className={OPTION}>
                {c === 'none' ? 'Aucune' : c}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Décimales" hint="Chiffres après la virgule sur les prix.">
          <Segmented
            ariaLabel="Décimales"
            value={a.decimals}
            onChange={v => set({ decimals: v })}
            options={[0, 1, 2, 3, 4].map(n => ({ value: n, label: String(n) }))}
          />
        </Row>
      </Group>

      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <p className="flex items-center gap-2 text-xs text-white/40">
          <Monitor className="h-3.5 w-3.5" />
          Appliqué immédiatement, dans les deux fenêtres.
        </p>
        <button
          onClick={reset}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1
                     text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white/85"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Tout réinitialiser
        </button>
      </div>
    </div>
  );
}
