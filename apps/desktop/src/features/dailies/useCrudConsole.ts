import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { TableCrud } from '../news/supabaseCrud';

/**
 * Machine à états d'une console d'administration « liste + éditeur ».
 *
 * Les consoles Dailys et Annonces portaient chacune la même : six `useState`
 * identiques, et les mêmes `reload` / `resetForm` / `startEdit` / `save` /
 * `remove` au mot près — ~90 lignes dupliquées. Seuls diffèrent réellement les
 * champs du formulaire et le rendu de la liste, qui restent dans chaque
 * console.
 *
 * Même esprit que `PressFeedsBackend` (PressFeedsManager) : un composant
 * générique piloté par un backend injecté.
 */
export interface CrudConsole<Model, Draft> {
  items: Model[];
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  editingId: string | null;
  busy: boolean;
  err: string | null;
  setErr: Dispatch<SetStateAction<string | null>>;
  /** Id dont la suppression attend confirmation (clic en deux temps). */
  confirmId: string | null;
  setConfirmId: Dispatch<SetStateAction<string | null>>;
  resetForm: () => void;
  startEdit: (model: Model) => void;
  save: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useCrudConsole<Model extends { id: string }, Draft, Input>(opts: {
  backend: TableCrud<Model, Input>;
  emptyDraft: Draft;
  /** Modèle existant → brouillon éditable. */
  toDraft: (model: Model) => Draft;
  /** Brouillon → payload, ou un message d'erreur si le brouillon est invalide. */
  toInput: (draft: Draft) => { ok: true; input: Input } | { ok: false; error: string };
}): CrudConsole<Model, Draft> {
  const { backend, emptyDraft, toDraft, toInput } = opts;

  const [items, setItems] = useState<Model[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { items: rows, error } = await backend.listAll();
    if (error !== null) setErr(error);
    else setItems(rows);
  }, [backend]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setDraft(emptyDraft);
  }, [emptyDraft]);

  const startEdit = useCallback(
    (model: Model) => {
      setEditingId(model.id);
      setDraft(toDraft(model));
    },
    [toDraft],
  );

  const save = useCallback(async () => {
    const parsed = toInput(draft);
    if (!parsed.ok) {
      setErr(parsed.error);
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } =
      editingId === null
        ? await backend.create(parsed.input)
        : await backend.update(editingId, parsed.input);
    setBusy(false);
    if (error !== null) {
      setErr(error);
      return;
    }
    resetForm();
    await reload();
  }, [backend, draft, editingId, reload, resetForm, toInput]);

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      setErr(null);
      const { error } = await backend.remove(id);
      setBusy(false);
      setConfirmId(null);
      if (error !== null) {
        setErr(error);
        return;
      }
      if (editingId === id) resetForm();
      await reload();
    },
    [backend, editingId, reload, resetForm],
  );

  return {
    items,
    draft,
    setDraft,
    editingId,
    busy,
    err,
    setErr,
    confirmId,
    setConfirmId,
    resetForm,
    startEdit,
    save,
    remove,
  };
}
