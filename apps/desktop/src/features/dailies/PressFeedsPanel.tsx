import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Play, Plus, Search, Trash2 } from 'lucide-react';
import {
  DAILY_CATEGORIES,
  DAILY_CATEGORY_LABEL,
  EMPTY_PRESS_FEED,
  PRESS_SOURCE_CATALOG,
  PRESS_SOURCE_GROUP_LABEL,
  type DailyCategory,
  type PressFeed,
  type PressFeedInput,
  type PressSourceGroup,
} from '@catdesk/shared-types';
import {
  createPressFeed,
  deletePressFeed,
  listPressFeeds,
  runPressDigestNow,
  updatePressFeed,
} from './pressFeedsAdmin';

const FIELD =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 ' +
  'outline-none placeholder-white/30 focus:border-brand-400/50';
const OPTION = 'bg-gray-900 text-white/90';
const LABEL = 'block text-xs font-medium text-white/50 mb-1';
const BTN_PRIMARY =
  'flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white ' +
  'transition-colors hover:bg-brand-500 disabled:opacity-50';
const BTN_GHOST = 'rounded-lg px-3 py-1.5 text-sm text-white/55 transition-colors hover:text-white/85';

/** Brouillon d'édition : les champs listes sont saisis en texte, convertis au save. */
interface Draft {
  name: string;
  category: DailyCategory;
  sourceIds: string[]; // sélection dans le catalogue intégré
  feedUrls: string; // une URL par ligne
  includeKeywords: string; // séparés par des virgules
  includeRegex: string;
  excludeRegex: string;
  sinceHours: number;
  articleLimit: number;
  enabled: boolean;
}

const EMPTY: Draft = {
  name: '',
  category: 'misc',
  sourceIds: [],
  feedUrls: '',
  includeKeywords: '',
  includeRegex: '',
  excludeRegex: '',
  sinceHours: EMPTY_PRESS_FEED.sinceHours,
  articleLimit: EMPTY_PRESS_FEED.articleLimit,
  enabled: true,
};

const csv = (s: string): string[] => s.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
const lines = (s: string): string[] => s.split(/\r?\n/).map((x) => x.trim()).filter((x) => x.length > 0);

function feedToDraft(f: PressFeed): Draft {
  return {
    name: f.name,
    category: f.category,
    sourceIds: f.sourceIds,
    feedUrls: f.feedUrls.join('\n'),
    includeKeywords: f.includeKeywords.join(', '),
    includeRegex: f.includeRegex ?? '',
    excludeRegex: f.excludeRegex ?? '',
    sinceHours: f.sinceHours,
    articleLimit: f.articleLimit,
    enabled: f.enabled,
  };
}

function draftToInput(d: Draft): PressFeedInput {
  return {
    name: d.name.trim(),
    category: d.category,
    sourceIds: d.sourceIds,
    feedUrls: lines(d.feedUrls),
    includeKeywords: csv(d.includeKeywords),
    includeRegex: d.includeRegex.trim() === '' ? null : d.includeRegex.trim(),
    excludeRegex: d.excludeRegex.trim() === '' ? null : d.excludeRegex.trim(),
    sinceHours: d.sinceHours,
    articleLimit: d.articleLimit,
    enabled: d.enabled,
  };
}

/** Minuscules sans accents, pour une recherche tolérante (« libe » → Libération). */
const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

const SOURCE_LABEL = new Map(PRESS_SOURCE_CATALOG.map((s) => [s.id, s.label]));

/** Résumé lisible des sources d'un journal (labels du catalogue + nb de flux perso). */
function sourceSummary(f: PressFeed): string {
  const parts = f.sourceIds.map((id) => SOURCE_LABEL.get(id) ?? id);
  if (f.feedUrls.length > 0) parts.push(`${f.feedUrls.length} flux perso`);
  return parts.length > 0 ? parts.join(', ') : 'aucune source';
}

/**
 * Sélecteur de sources intégrées : recherche + pastilles par famille. Les ids
 * inconnus du catalogue (sources retirées) restent listés pour être retirables.
 */
function SourcePicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('');
  const q = fold(query.trim());

  const groups = useMemo(() => {
    const matches = PRESS_SOURCE_CATALOG.filter(
      (s) => q === '' || fold(s.label).includes(q) || fold(s.id).includes(q),
    );
    const byGroup = new Map<PressSourceGroup, typeof matches>();
    for (const s of matches) {
      const g = byGroup.get(s.group) ?? [];
      g.push(s);
      byGroup.set(s.group, g);
    }
    return byGroup;
  }, [q]);

  const known = new Set(PRESS_SOURCE_CATALOG.map((s) => s.id));
  const unknown = selected.filter((id) => !known.has(id));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
        <input
          className={`${FIELD} pl-8`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
              {sources.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggle(s.id)}
                    aria-pressed={on}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      on
                        ? 'bg-brand-600 text-white'
                        : 'bg-white/5 text-white/55 hover:bg-white/10 hover:text-white/85'
                    }`}
                  >
                    {s.label}
                    <span className={`ml-1 text-[9px] uppercase ${on ? 'text-white/60' : 'text-white/30'}`}>
                      {s.lang}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {groups.size === 0 && <p className="text-xs text-white/30">Aucune source pour « {query.trim()} ».</p>}
        {unknown.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {unknown.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/25"
                title="Source inconnue du catalogue — cliquer pour retirer"
              >
                {id} ✕
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Valide un motif regex saisi ; renvoie un message d'erreur ou null. */
function regexError(pattern: string): string | null {
  if (pattern.trim() === '') return null;
  try {
    new RegExp(pattern, 'iu');
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'motif invalide';
  }
}

/**
 * Gestion des journaux personnalisés (admin) : recettes de collecte (sources +
 * URLs de flux + mots-clés/regex) publiées chaque jour en dailys. Bouton
 * « Publier maintenant » pour lancer un run immédiat (poste admin uniquement).
 */
export function PressFeedsPanel() {
  const [items, setItems] = useState<PressFeed[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { items: rows, error } = await listPressFeeds();
    if (error !== null) setErr(error);
    else setItems(rows);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const resetForm = () => {
    setEditingId(null);
    setDraft(EMPTY);
  };

  const startEdit = (f: PressFeed) => {
    setEditingId(f.id);
    setDraft(feedToDraft(f));
  };

  const save = async () => {
    if (draft.name.trim() === '') {
      setErr('Le nom du journal est requis.');
      return;
    }
    const incErr = regexError(draft.includeRegex);
    const excErr = regexError(draft.excludeRegex);
    if (incErr !== null || excErr !== null) {
      setErr(`Regex invalide : ${incErr ?? excErr}`);
      return;
    }
    const input = draftToInput(draft);
    if (input.sourceIds.length === 0 && input.feedUrls.length === 0) {
      setErr('Ajoute au moins une source intégrée ou une URL de flux.');
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } =
      editingId === null ? await createPressFeed(input) : await updatePressFeed(editingId, input);
    setBusy(false);
    if (error !== null) {
      setErr(error);
      return;
    }
    resetForm();
    await reload();
  };

  const remove = async (id: string) => {
    setBusy(true);
    setErr(null);
    const { error } = await deletePressFeed(id);
    setBusy(false);
    setConfirmId(null);
    if (error !== null) {
      setErr(error);
      return;
    }
    if (editingId === id) resetForm();
    await reload();
  };

  const publishNow = async () => {
    setRunMsg('Lancement…');
    const { error } = await runPressDigestNow();
    setRunMsg(
      error !== null
        ? `Échec : ${error}`
        : 'Publication lancée — les dailys apparaîtront dans une minute environ.',
    );
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button className={BTN_PRIMARY} onClick={() => void publishNow()}>
          <Play className="h-3.5 w-3.5" />
          Publier maintenant
        </button>
        {runMsg !== null && <span className="text-xs text-white/55">{runMsg}</span>}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Éditeur */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h2 className="text-sm font-semibold text-white/90">
            {editingId === null ? 'Nouveau journal personnalisé' : 'Modifier le journal'}
          </h2>
          <div className="mt-3 space-y-3">
            <label className={LABEL}>
              Nom du journal
              <input
                className={FIELD}
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Le Monde · IA"
              />
            </label>
            <label className={LABEL}>
              Catégorie
              <select
                className={FIELD}
                value={draft.category}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as DailyCategory }))}
              >
                {DAILY_CATEGORIES.map((c) => (
                  <option key={c} value={c} className={OPTION}>
                    {DAILY_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className={LABEL}>
                Sources ({draft.sourceIds.length} sélectionnée{draft.sourceIds.length > 1 ? 's' : ''}) —
                clique pour ajouter/retirer
              </span>
              <SourcePicker
                selected={draft.sourceIds}
                onChange={(ids) => setDraft((d) => ({ ...d, sourceIds: ids }))}
              />
            </div>
            <label className={LABEL}>
              URLs de flux RSS/Atom supplémentaires (avancé, une par ligne) — optionnel
              <textarea
                className={`${FIELD} resize-y font-mono text-xs`}
                rows={2}
                value={draft.feedUrls}
                onChange={(e) => setDraft((d) => ({ ...d, feedUrls: e.target.value }))}
                placeholder={'https://hnrss.org/frontpage\nhttps://blog.rust-lang.org/feed.xml'}
              />
            </label>
            <label className={LABEL}>
              Mots-clés (garde ceux qui en contiennent un ; séparés par des virgules)
              <input
                className={FIELD}
                value={draft.includeKeywords}
                onChange={(e) => setDraft((d) => ({ ...d, includeKeywords: e.target.value }))}
                placeholder="IA, intelligence artificielle, LLM"
              />
            </label>
            <label className={LABEL}>
              Regex à inclure (ne garde que ce qui matche) — optionnel
              <input
                className={`${FIELD} font-mono text-xs`}
                value={draft.includeRegex}
                onChange={(e) => setDraft((d) => ({ ...d, includeRegex: e.target.value }))}
                placeholder="(IA|intelligence artificielle|LLM)"
              />
            </label>
            <label className={LABEL}>
              Regex à exclure (retire ce qui matche) — optionnel
              <input
                className={`${FIELD} font-mono text-xs`}
                value={draft.excludeRegex}
                onChange={(e) => setDraft((d) => ({ ...d, excludeRegex: e.target.value }))}
                placeholder="(publi.?rédactionnel|sponsorisé)"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL}>
                Fenêtre (heures)
                <input
                  className={FIELD}
                  type="number"
                  min={1}
                  max={168}
                  value={draft.sinceHours}
                  onChange={(e) => setDraft((d) => ({ ...d, sinceHours: Number(e.target.value) }))}
                />
              </label>
              <label className={LABEL}>
                Articles max
                <input
                  className={FIELD}
                  type="number"
                  min={1}
                  max={200}
                  value={draft.articleLimit}
                  onChange={(e) => setDraft((d) => ({ ...d, articleLimit: Number(e.target.value) }))}
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-white/60">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
              />
              Actif (collecté et publié chaque jour)
            </label>

            {err !== null && <p className="text-xs text-red-400/80">{err}</p>}

            <div className="flex items-center gap-2">
              <button className={BTN_PRIMARY} disabled={busy} onClick={() => void save()}>
                <Plus className="h-3.5 w-3.5" />
                {editingId === null ? 'Créer' : 'Enregistrer'}
              </button>
              {editingId !== null && (
                <button className={BTN_GHOST} onClick={resetForm}>
                  Annuler
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Liste */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-white/90">
            Journaux personnalisés <span className="text-white/40">({items.length})</span>
          </h2>
          {items.length === 0 ? (
            <p className="text-sm text-white/35">Aucun journal personnalisé pour l'instant.</p>
          ) : (
            <ul className="space-y-2">
              {items.map((f) => {
                return (
                  <li key={f.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded bg-brand-600/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-200">
                        {DAILY_CATEGORY_LABEL[f.category]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/85">{f.name}</span>
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
                        onClick={() => startEdit(f)}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-white/55 hover:bg-white/10 hover:text-white/85"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Éditer
                      </button>
                      <button
                        onClick={() => (confirmId === f.id ? void remove(f.id) : setConfirmId(f.id))}
                        onBlur={() => setConfirmId((id) => (id === f.id ? null : id))}
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
      </div>
    </div>
  );
}
