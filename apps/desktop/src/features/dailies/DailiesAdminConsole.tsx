import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, LogOut, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  DAILY_CATEGORIES,
  DAILY_CATEGORY_LABEL,
  type Daily,
  type DailyCategory,
} from '@catdesk/shared-types';
import { NewsMarkdown } from '../news/NewsMarkdown';
import { useAdminSession, signInAdmin, signOutAdmin } from './adminAuth';
import { createDaily, deleteDaily, listAllDailies, updateDaily, type DailyInput } from './dailiesAdmin';
import { PressFeedsPanel } from './PressFeedsPanel';

const FIELD =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 ' +
  'outline-none placeholder-white/30 focus:border-brand-400/50';
const OPTION = 'bg-gray-900 text-white/90';
const LABEL = 'block text-xs font-medium text-white/50 mb-1';
const BTN_PRIMARY =
  'flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white ' +
  'transition-colors hover:bg-brand-500 disabled:opacity-50';
const BTN_GHOST = 'rounded-lg px-3 py-1.5 text-sm text-white/55 transition-colors hover:text-white/85';

function isoToLocalInput(iso: string | null): string {
  if (iso === null) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatPublished(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

interface Draft {
  title: string;
  body: string;
  category: DailyCategory;
  expiresAt: string; // valeur datetime-local ('' = aucune)
}

const EMPTY: Draft = { title: '', body: '', category: 'markets', expiresAt: '' };

/**
 * Console d'administration des dailys — réservée à l'admin (claim
 * `app_metadata.role = 'admin'`). Permet de rédiger, éditer, faire expirer et
 * supprimer les dailys. Les écritures sont en plus bornées par la RLS serveur :
 * un non-admin ne peut rien publier, même en contournant l'UI.
 */
export function DailiesAdminConsole({ onClose }: { onClose: () => void }) {
  const { loading, isAdmin, email } = useAdminSession();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-950 text-white">
      <header className="flex items-center gap-2.5 border-b border-white/10 px-5 py-3">
        <button onClick={onClose} className="flex items-center gap-1 text-sm text-white/60 hover:text-white/90">
          <ArrowLeft className="h-4 w-4" />
          Retour
        </button>
        <ShieldCheck className="ml-1 h-4 w-4 text-brand-400" />
        <span className="text-sm font-semibold text-white/90">Console — Dailys</span>
        {isAdmin && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-white/40">{email}</span>
            <button
              onClick={() => void signOutAdmin()}
              className="flex items-center gap-1 text-xs text-white/55 hover:text-white/85"
            >
              <LogOut className="h-3.5 w-3.5" />
              Déconnexion
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {loading ? (
          <p className="text-sm text-white/40">Chargement…</p>
        ) : isAdmin ? (
          <AdminTabs />
        ) : (
          <AdminLogin />
        )}
      </div>
    </div>
  );
}

/** Onglets de la console admin : dailys manuelles vs journaux personnalisés. */
function AdminTabs() {
  const [tab, setTab] = useState<'dailies' | 'feeds'>('dailies');
  const tabClass = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? 'bg-brand-600 text-white' : 'text-white/55 hover:bg-white/10 hover:text-white/85'
    }`;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center gap-2">
        <button className={tabClass(tab === 'dailies')} onClick={() => setTab('dailies')}>
          Dailys
        </button>
        <button className={tabClass(tab === 'feeds')} onClick={() => setTab('feeds')}>
          Journaux personnalisés
        </button>
      </div>
      {tab === 'dailies' ? <Console /> : <PressFeedsPanel />}
    </div>
  );
}

/** Formulaire de connexion admin. */
function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await signInAdmin(email.trim(), password);
    setBusy(false);
    if (error !== null) setErr(error);
    // En cas de succès, useAdminSession bascule l'affichage automatiquement.
  };

  return (
    <div className="mx-auto max-w-sm rounded-xl border border-white/10 bg-white/5 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white/90">
        <ShieldCheck className="h-4 w-4 text-brand-400" />
        Connexion administrateur
      </h2>
      <p className="mt-1 text-xs text-white/45">
        Réservé à l'auteur des dailys. Les autres comptes n'ont aucun droit d'écriture.
      </p>
      <div className="mt-4 space-y-3">
        <label className={LABEL}>
          E-mail
          <input
            className={FIELD}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@exemple.com"
          />
        </label>
        <label className={LABEL}>
          Mot de passe
          <input
            className={FIELD}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </label>
        {err !== null && <p className="text-xs text-red-400/80">{err}</p>}
        <button className={BTN_PRIMARY} disabled={busy} onClick={() => void submit()}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </div>
    </div>
  );
}

/** CRUD des dailys (admin connecté). */
function Console() {
  const [items, setItems] = useState<Daily[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { items: rows, error } = await listAllDailies();
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

  const startEdit = (d: Daily) => {
    setEditingId(d.id);
    setDraft({ title: d.title, body: d.body, category: d.category, expiresAt: isoToLocalInput(d.expiresAt) });
  };

  const save = async () => {
    if (draft.title.trim() === '' || draft.body.trim() === '') {
      setErr('Titre et contenu sont requis.');
      return;
    }
    const input: DailyInput = {
      title: draft.title.trim(),
      body: draft.body.trim(),
      category: draft.category,
      expiresAt: draft.expiresAt === '' ? null : new Date(draft.expiresAt).toISOString(),
    };
    setBusy(true);
    setErr(null);
    const { error } = editingId === null ? await createDaily(input) : await updateDaily(editingId, input);
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
    const { error } = await deleteDaily(id);
    setBusy(false);
    setConfirmId(null);
    if (error !== null) {
      setErr(error);
      return;
    }
    if (editingId === id) resetForm();
    await reload();
  };

  const now = Date.now();

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-2">
      {/* Éditeur */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold text-white/90">
          {editingId === null ? 'Nouvelle daily' : 'Modifier la daily'}
        </h2>
        <div className="mt-3 space-y-3">
          <label className={LABEL}>
            Titre
            <input
              className={FIELD}
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Ouverture des marchés"
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
          <label className={LABEL}>
            Contenu (Markdown)
            <textarea
              className={`${FIELD} resize-y`}
              rows={5}
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              placeholder="Les futures US **en hausse**…"
            />
          </label>
          <label className={LABEL}>
            Expiration (optionnel)
            <input
              className={FIELD}
              type="datetime-local"
              value={draft.expiresAt}
              onChange={(e) => setDraft((d) => ({ ...d, expiresAt: e.target.value }))}
            />
          </label>

          {err !== null && <p className="text-xs text-red-400/80">{err}</p>}

          <div className="flex items-center gap-2">
            <button className={BTN_PRIMARY} disabled={busy} onClick={() => void save()}>
              <Plus className="h-3.5 w-3.5" />
              {editingId === null ? 'Publier' : 'Enregistrer'}
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
          Dailys publiées <span className="text-white/40">({items.length})</span>
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-white/35">Aucune daily pour l'instant.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((d) => {
              const expired = d.expiresAt !== null && Date.parse(d.expiresAt) <= now;
              return (
                <li key={d.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded bg-brand-600/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-200">
                      {DAILY_CATEGORY_LABEL[d.category]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/85">{d.title}</span>
                    {expired && (
                      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/40">
                        expirée
                      </span>
                    )}
                    <span className="shrink-0 text-[11px] tabular-nums text-white/30">
                      {formatPublished(d.publishedAt)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-white/55">
                    <NewsMarkdown content={d.body} />
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      onClick={() => startEdit(d)}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-white/55 hover:bg-white/10 hover:text-white/85"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Éditer
                    </button>
                    <button
                      onClick={() => (confirmId === d.id ? void remove(d.id) : setConfirmId(d.id))}
                      onBlur={() => setConfirmId((id) => (id === d.id ? null : id))}
                      disabled={busy}
                      className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                        confirmId === d.id
                          ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30'
                          : 'text-white/55 hover:bg-white/10 hover:text-red-300'
                      }`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {confirmId === d.id ? 'Confirmer ?' : 'Supprimer'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
