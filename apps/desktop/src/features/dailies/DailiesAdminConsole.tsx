import { useState } from 'react';
import { ArrowLeft, LogOut, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  DAILY_CATEGORIES,
  DAILY_CATEGORY_LABEL,
  type Daily,
  type DailyCategory,
  type NewsItem,
  type NewsSeverity,
} from '@catdesk/shared-types';
import { NewsMarkdown } from '../news/NewsMarkdown';
import { NEWS_ICON, NEWS_ICON_COLOR } from '../news/newsStyles';
import { useAdminSession, signInAdmin, signOutAdmin } from './adminAuth';
import { dailiesCrud, type DailyInput } from './dailiesAdmin';
import { newsCrud, type NewsInput } from '../news/newsAdmin';
import { useCrudConsole } from './useCrudConsole';
import { BTN_GHOST, BTN_PRIMARY, FIELD, LABEL, OPTION } from '../../shared/ui/tokens';

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
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Draft {
  title: string;
  body: string;
  category: DailyCategory;
  expiresAt: string; // valeur datetime-local ('' = aucune)
}

const EMPTY: Draft = { title: '', body: '', category: 'markets', expiresAt: '' };

type Tab = 'dailies' | 'news';

const TAB_BTN =
  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors';
const TAB_ACTIVE = 'bg-brand-600/80 text-white';
const TAB_INACTIVE = 'text-white/50 hover:bg-white/5 hover:text-white/80';

/**
 * Console d'administration — réservée à l'admin (claim
 * `app_metadata.role = 'admin'`). Deux onglets, chacun son métier : les dailys
 * manuelles (rédiger/éditer/faire expirer/supprimer) et les annonces news
 * (mêmes actions, diffusion globale ou ciblée) — publiées directement depuis
 * l'app, plus besoin de Supabase Studio. La gestion des journaux (persos ET
 * partagés) vit dans l'écran « Journaux » — une seule interface pour un même
 * travail. Les écritures sont en plus bornées par la RLS serveur : un
 * non-admin ne peut rien publier, même en contournant l'UI.
 */
export function DailiesAdminConsole({ onClose }: { onClose: () => void }) {
  const { loading, isAdmin, email } = useAdminSession();
  const [tab, setTab] = useState<Tab>('dailies');

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-950 text-white">
      <header className="flex items-center gap-2.5 border-b border-white/10 px-5 py-3">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-sm text-white/60 hover:text-white/90"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour
        </button>
        <ShieldCheck className="ml-1 h-4 w-4 text-brand-400" />
        <span className="text-sm font-semibold text-white/90">Console admin</span>

        {isAdmin && (
          <div className="ml-2 flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
            <button
              onClick={() => setTab('dailies')}
              className={`${TAB_BTN} ${tab === 'dailies' ? TAB_ACTIVE : TAB_INACTIVE}`}
            >
              Dailys manuelles
            </button>
            <button
              onClick={() => setTab('news')}
              className={`${TAB_BTN} ${tab === 'news' ? TAB_ACTIVE : TAB_INACTIVE}`}
            >
              Annonces
            </button>
          </div>
        )}

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
        ) : !isAdmin ? (
          <AdminLogin />
        ) : tab === 'dailies' ? (
          <DailiesConsole />
        ) : (
          <NewsConsole />
        )}
      </div>
    </div>
  );
}

/** Formulaire de connexion admin. Réutilisé par la portée « Partagés » de « Journaux ». */
export function AdminLogin() {
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
            onChange={e => setEmail(e.target.value)}
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
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => {
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
function DailiesConsole() {
  const {
    items,
    draft,
    setDraft,
    editingId,
    busy,
    err,
    confirmId,
    setConfirmId,
    resetForm,
    startEdit,
    save,
    remove,
  } = useCrudConsole<Daily, Draft, DailyInput>({
    backend: dailiesCrud,
    emptyDraft: EMPTY,
    toDraft: d => ({
      title: d.title,
      body: d.body,
      category: d.category,
      expiresAt: isoToLocalInput(d.expiresAt),
    }),
    toInput: d =>
      d.title.trim() === '' || d.body.trim() === ''
        ? { ok: false, error: 'Titre et contenu sont requis.' }
        : {
            ok: true,
            input: {
              title: d.title.trim(),
              body: d.body.trim(),
              category: d.category,
              expiresAt: d.expiresAt === '' ? null : new Date(d.expiresAt).toISOString(),
            },
          },
  });

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
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="Ouverture des marchés"
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
          <label className={LABEL}>
            Contenu (Markdown)
            <textarea
              className={`${FIELD} resize-y`}
              rows={5}
              value={draft.body}
              onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
              placeholder="Les futures US **en hausse**…"
            />
          </label>
          <label className={LABEL}>
            Expiration (optionnel)
            <input
              className={FIELD}
              type="datetime-local"
              value={draft.expiresAt}
              onChange={e => setDraft(d => ({ ...d, expiresAt: e.target.value }))}
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
            {items.map(d => {
              const expired = d.expiresAt !== null && Date.parse(d.expiresAt) <= now;
              return (
                <li key={d.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded bg-brand-600/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-200">
                      {DAILY_CATEGORY_LABEL[d.category]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/85">
                      {d.title}
                    </span>
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
                      onBlur={() => setConfirmId(id => (id === d.id ? null : id))}
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

// ─── Annonces (news) ────────────────────────────────────────────
// Même métier que les dailys manuelles (rédiger/éditer/expirer/supprimer),
// diffusées globalement ou ciblées sur un poste précis (auth.uid()). Publiées
// directement depuis l'app (RLS admin-only, cf. supabase/migrations/
// 20260628000000_news.sql) — plus besoin de Supabase Studio.

const SEVERITIES: readonly NewsSeverity[] = ['info', 'success', 'warning', 'critical'];

const SEVERITY_LABEL: Record<NewsSeverity, string> = {
  info: 'Info',
  success: 'Succès',
  warning: 'Avertissement',
  critical: 'Critique',
};

interface NewsDraft {
  title: string;
  body: string;
  severity: NewsSeverity;
  /** true = tous les postes (audience_client_id null). Coché par défaut : le
   * global doit être un choix visible, jamais un défaut silencieux — un test
   * manuel de cette API a montré qu'omettre le champ le fait basculer global
   * sans le vouloir. */
  global: boolean;
  /** uid brut si global=false — aucun sélecteur : pas d'annuaire des postes
   * dans l'app aujourd'hui (à récupérer dans Supabase Studio si besoin). */
  audienceClientId: string;
  expiresAt: string; // valeur datetime-local ('' = aucune)
}

const EMPTY_NEWS: NewsDraft = {
  title: '',
  body: '',
  severity: 'info',
  global: true,
  audienceClientId: '',
  expiresAt: '',
};

/** CRUD des annonces (admin connecté). */
function NewsConsole() {
  const {
    items,
    draft,
    setDraft,
    editingId,
    busy,
    err,
    confirmId,
    setConfirmId,
    resetForm,
    startEdit,
    save,
    remove,
  } = useCrudConsole<NewsItem, NewsDraft, NewsInput>({
    backend: newsCrud,
    emptyDraft: EMPTY_NEWS,
    toDraft: n => ({
      title: n.title,
      body: n.body,
      severity: n.severity,
      global: n.audienceClientId === null,
      audienceClientId: n.audienceClientId ?? '',
      expiresAt: isoToLocalInput(n.expiresAt),
    }),
    toInput: d => {
      if (d.title.trim() === '' || d.body.trim() === '') {
        return { ok: false, error: 'Titre et contenu sont requis.' };
      }
      if (!d.global && d.audienceClientId.trim() === '') {
        return { ok: false, error: "Renseigne l'ID du poste visé, ou coche « Tous les postes »." };
      }
      return {
        ok: true,
        input: {
          title: d.title.trim(),
          body: d.body.trim(),
          severity: d.severity,
          audienceClientId: d.global ? null : d.audienceClientId.trim(),
          expiresAt: d.expiresAt === '' ? null : new Date(d.expiresAt).toISOString(),
        },
      };
    },
  });

  const now = Date.now();

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-2">
      {/* Éditeur */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold text-white/90">
          {editingId === null ? 'Nouvelle annonce' : "Modifier l'annonce"}
        </h2>
        <div className="mt-3 space-y-3">
          <label className={LABEL}>
            Titre
            <input
              className={FIELD}
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="Nouvelle version disponible"
            />
          </label>
          <label className={LABEL}>
            Gravité
            <select
              className={FIELD}
              value={draft.severity}
              onChange={e => setDraft(d => ({ ...d, severity: e.target.value as NewsSeverity }))}
            >
              {SEVERITIES.map(s => (
                <option key={s} value={s} className={OPTION}>
                  {SEVERITY_LABEL[s]}
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
              onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
              placeholder="La version 1.4 corrige…"
            />
          </label>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <label className="flex items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={draft.global}
                onChange={e => setDraft(d => ({ ...d, global: e.target.checked }))}
              />
              Tous les postes (diffusion globale)
            </label>
            {!draft.global && (
              <div className="mt-2">
                <label className={LABEL}>
                  ID du poste visé (avancé)
                  <input
                    className={FIELD}
                    value={draft.audienceClientId}
                    onChange={e => setDraft(d => ({ ...d, audienceClientId: e.target.value }))}
                    placeholder="uid — Supabase Studio → Authentication → Users"
                  />
                </label>
                <p className="mt-1 text-[11px] text-white/35">
                  Pas d'annuaire dans l'app : récupère cet identifiant dans Supabase Studio.
                </p>
              </div>
            )}
          </div>

          <label className={LABEL}>
            Expiration (optionnel)
            <input
              className={FIELD}
              type="datetime-local"
              value={draft.expiresAt}
              onChange={e => setDraft(d => ({ ...d, expiresAt: e.target.value }))}
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
          Annonces publiées <span className="text-white/40">({items.length})</span>
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-white/35">Aucune annonce pour l'instant.</p>
        ) : (
          <ul className="space-y-2">
            {items.map(n => {
              const expired = n.expiresAt !== null && Date.parse(n.expiresAt) <= now;
              const Icon = NEWS_ICON[n.severity];
              return (
                <li key={n.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${NEWS_ICON_COLOR[n.severity]}`} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/85">
                      {n.title}
                    </span>
                    <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
                      {n.audienceClientId === null ? 'Tous' : 'Ciblée'}
                    </span>
                    {expired && (
                      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/40">
                        expirée
                      </span>
                    )}
                    <span className="shrink-0 text-[11px] tabular-nums text-white/30">
                      {formatPublished(n.publishedAt)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-white/55">
                    <NewsMarkdown content={n.body} />
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      onClick={() => startEdit(n)}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-white/55 hover:bg-white/10 hover:text-white/85"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Éditer
                    </button>
                    <button
                      onClick={() => (confirmId === n.id ? void remove(n.id) : setConfirmId(n.id))}
                      onBlur={() => setConfirmId(id => (id === n.id ? null : id))}
                      disabled={busy}
                      className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                        confirmId === n.id
                          ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30'
                          : 'text-white/55 hover:bg-white/10 hover:text-red-300'
                      }`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {confirmId === n.id ? 'Confirmer ?' : 'Supprimer'}
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
