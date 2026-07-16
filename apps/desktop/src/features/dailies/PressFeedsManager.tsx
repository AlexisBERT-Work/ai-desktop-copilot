import { useCallback, useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import type { PressFeed, PressFeedInput } from '@catdesk/shared-types';
import {
  EMPTY_DRAFT as EMPTY,
  draftToInput,
  feedToDraft,
  regexError,
  type Draft,
} from './pressFeedsModel';
import { PressFeedEditor } from './PressFeedEditor';
import { PressFeedList } from './PressFeedList';
import { BTN_PRIMARY } from './pressFeedsUi';

/**
 * Backend d'un gestionnaire de journaux personnalisés. Deux implémentations :
 * - admin (Supabase) : journaux PARTAGÉS, publiés pour tous les clients ;
 * - local (agent de ce poste) : journaux PERSONNELS, générés localement.
 */
export interface PressFeedsBackend {
  list: () => Promise<{ items: PressFeed[]; error: string | null }>;
  create: (input: PressFeedInput) => Promise<{ error: string | null }>;
  update: (id: string, input: PressFeedInput) => Promise<{ error: string | null }>;
  remove: (id: string) => Promise<{ error: string | null }>;
  /** Publication/génération immédiate (fire-and-forget côté agent). */
  runNow: () => Promise<{ error: string | null }>;
  /** Libellé du bouton de run (« Publier maintenant » / « Générer maintenant »). */
  runLabel: string;
  /** Message affiché quand le run est lancé. */
  runStartedMsg: string;
  /** Abonnement optionnel : pousse la liste à jour (stores événementiels). */
  subscribe?: (cb: (items: PressFeed[]) => void) => () => void;
}

// Logique métier (brouillon ↔ modèle, parsing, validation) : pressFeedsModel.ts (testé).
// Vues : PressFeedEditor.tsx (formulaire) et PressFeedList.tsx (liste).

/**
 * Gestion générique des journaux personnalisés : recettes de collecte (sources +
 * URLs de flux + mots-clés/regex) transformées chaque jour en dailys. Le backend
 * décide où elles vivent (Supabase partagé ou agent local de ce poste).
 */
export function PressFeedsManager({ backend }: { backend: PressFeedsBackend }) {
  const [items, setItems] = useState<PressFeed[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { items: rows, error } = await backend.list();
    if (error !== null) setErr(error);
    else setItems(rows);
  }, [backend]);

  useEffect(() => {
    void reload();
    // Les backends événementiels (agent local) poussent leurs mises à jour.
    return backend.subscribe?.(setItems);
  }, [reload, backend]);

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
      editingId === null ? await backend.create(input) : await backend.update(editingId, input);
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
    const { error } = await backend.remove(id);
    setBusy(false);
    if (error !== null) {
      setErr(error);
      return;
    }
    if (editingId === id) resetForm();
    await reload();
  };

  const publishNow = async () => {
    setRunMsg('Lancement…');
    const { error } = await backend.runNow();
    setRunMsg(error !== null ? `Échec : ${error}` : backend.runStartedMsg);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button className={BTN_PRIMARY} onClick={() => void publishNow()}>
          <Play className="h-3.5 w-3.5" />
          {backend.runLabel}
        </button>
        {runMsg !== null && <span className="text-xs text-white/55">{runMsg}</span>}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <PressFeedEditor
          draft={draft}
          setDraft={setDraft}
          editingId={editingId}
          busy={busy}
          err={err}
          onSave={save}
          onCancel={resetForm}
        />
        <PressFeedList items={items} busy={busy} onEdit={startEdit} onRemove={remove} />
      </div>
    </div>
  );
}
