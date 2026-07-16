import { Filter, Plus, Settings2 } from 'lucide-react';
import {
  DAILY_CATEGORIES,
  DAILY_CATEGORY_LABEL,
  EMPTY_PRESS_FEED,
  type DailyCategory,
} from '@catdesk/shared-types';
import { csv, lines, type Draft } from './pressFeedsModel';
import { SourcePicker } from './SourcePicker';
import { BTN_GHOST, BTN_PRIMARY, FIELD, LABEL, OPTION, OptSection, Req } from './pressFeedsUi';

/**
 * Formulaire de création/édition d'un journal personnalisé. Contrôlé : le
 * brouillon et les erreurs vivent chez le parent (PressFeedsManager), qui
 * porte aussi la validation et les appels backend.
 */
export function PressFeedEditor({
  draft,
  setDraft,
  editingId,
  busy,
  err,
  onSave,
  onCancel,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  editingId: string | null;
  busy: boolean;
  err: string | null;
  onSave: () => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h2 className="text-sm font-semibold text-white/90">
        {editingId === null ? 'Nouveau journal personnalisé' : 'Modifier le journal'}
      </h2>
      <div className="mt-3 space-y-3">
        {/* ─── L'essentiel ─── */}
        <label className={LABEL}>
          <span>
            Nom du journal
            <Req />
          </span>
          <input
            className={FIELD}
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="Veille IA, Revue crypto…"
          />
        </label>
        <label className={LABEL}>
          Catégorie
          <select
            className={FIELD}
            value={draft.category}
            onChange={e => setDraft(d => ({ ...d, category: e.target.value as DailyCategory }))}
          >
            {DAILY_CATEGORIES.map(c => (
              <option key={c} value={c} className={OPTION}>
                {DAILY_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className={LABEL}>
            <span>
              Sources
              <Req />
            </span>{' '}
            {draft.sourceIds.length > 0 ? (
              <span className="text-brand-300">
                {draft.sourceIds.length} sélectionnée{draft.sourceIds.length > 1 ? 's' : ''}
              </span>
            ) : (
              'clique pour choisir'
            )}
          </span>
          <SourcePicker
            selected={draft.sourceIds}
            onChange={ids => setDraft(d => ({ ...d, sourceIds: ids }))}
          />
        </div>

        {/* ─── Optionnel : affiner la sélection ─── */}
        <OptSection
          title="Affiner la sélection"
          Icon={Filter}
          activeCount={
            (csv(draft.includeKeywords).length > 0 ? 1 : 0) +
            (draft.includeRegex.trim() !== '' ? 1 : 0) +
            (draft.excludeRegex.trim() !== '' ? 1 : 0)
          }
        >
          <label className={LABEL}>
            Mots-clés — garde les articles qui contiennent AU MOINS UN (virgules)
            <input
              className={FIELD}
              value={draft.includeKeywords}
              onChange={e => setDraft(d => ({ ...d, includeKeywords: e.target.value }))}
              placeholder="IA, intelligence artificielle, LLM"
            />
          </label>
          <label className={LABEL}>
            Regex à inclure — ne garde que ce qui matche
            <input
              className={`${FIELD} font-mono text-xs`}
              value={draft.includeRegex}
              onChange={e => setDraft(d => ({ ...d, includeRegex: e.target.value }))}
              placeholder="\b(IA|LLM|ChatGPT)\b"
            />
          </label>
          <label className={LABEL}>
            Regex à exclure — retire ce qui matche
            <input
              className={`${FIELD} font-mono text-xs`}
              value={draft.excludeRegex}
              onChange={e => setDraft(d => ({ ...d, excludeRegex: e.target.value }))}
              placeholder="(publi.?rédactionnel|sponsorisé)"
            />
          </label>
        </OptSection>

        {/* ─── Optionnel : réglages avancés ─── */}
        <OptSection
          title="Réglages avancés"
          Icon={Settings2}
          activeCount={
            lines(draft.feedUrls).length +
            (draft.sinceHours !== EMPTY_PRESS_FEED.sinceHours ? 1 : 0) +
            (draft.articleLimit !== EMPTY_PRESS_FEED.articleLimit ? 1 : 0)
          }
        >
          <label className={LABEL}>
            URLs de flux RSS/Atom hors catalogue (une par ligne)
            <textarea
              className={`${FIELD} resize-y font-mono text-xs`}
              rows={2}
              value={draft.feedUrls}
              onChange={e => setDraft(d => ({ ...d, feedUrls: e.target.value }))}
              placeholder={'https://hnrss.org/frontpage\nhttps://blog.rust-lang.org/feed.xml'}
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
                onChange={e => setDraft(d => ({ ...d, sinceHours: Number(e.target.value) }))}
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
                onChange={e => setDraft(d => ({ ...d, articleLimit: Number(e.target.value) }))}
              />
            </label>
          </div>
        </OptSection>

        {/* ─── Interrupteur actif/inactif ─── */}
        <label className="flex w-fit cursor-pointer items-center gap-2.5 text-xs font-medium text-white/60 transition-colors hover:text-white/85">
          <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={draft.enabled}
              onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))}
            />
            <span className="absolute inset-0 rounded-full bg-white/10 transition-colors duration-200 peer-checked:bg-brand-600" />
            <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white/60 transition-all duration-200 peer-checked:translate-x-4 peer-checked:bg-white" />
          </span>
          {draft.enabled ? 'Actif — collecté et publié chaque jour' : 'Inactif — mis en pause'}
        </label>

        <p className="text-[10px] text-white/30">
          <span className="text-brand-300">*</span> champs requis — le reste a des valeurs par
          défaut sensées.
        </p>

        {err !== null && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {err}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button className={BTN_PRIMARY} disabled={busy} onClick={() => void onSave()}>
            <Plus className="h-3.5 w-3.5" />
            {editingId === null ? 'Créer' : 'Enregistrer'}
          </button>
          {editingId !== null && (
            <button className={BTN_GHOST} onClick={onCancel}>
              Annuler
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
