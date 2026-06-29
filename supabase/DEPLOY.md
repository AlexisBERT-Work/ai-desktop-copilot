# Déploiement Supabase (CLI) — news pilotée par l'admin

Runbook **reproductible** pour provisionner le backend de la news (Pilier B) avec
le **CLI Supabase**, déjà installé en devDependency (`pnpm exec supabase`).

> Contexte fonctionnel et modèle de données : [../docs/projects/dashboard-p2.md](../docs/projects/dashboard-p2.md).
> Schéma appliqué : [migrations/20260628000000_news.sql](migrations/20260628000000_news.sql).

Ce qui est **déjà fait dans le repo** (rien à refaire) :

- CLI Supabase épinglé (`supabase` en devDependency racine).
- `supabase/config.toml` : `project_id = "catdesk"` + **`enable_anonymous_sign_ins = true`**.
- Migration au format timestamp, prête pour `db push`.
- `apps/desktop/.env` créé (vide, gitignoré) — à renseigner à l'étape 6.

Les étapes ci-dessous nécessitent **ton compte Supabase** : exécute-les toi-même
dans un terminal à la racine du repo.

> ⚠️ **PowerShell** : `<` est un opérateur réservé — n'écris **jamais** de
> chevrons (`<REF>`) dans une commande, ça casse le parseur. On passe les valeurs
> par des **variables** (`$ref`, `$dbpass`) que tu renseignes une fois.

---

## 1. Connexion (ouvre le navigateur)

```powershell
pnpm exec supabase login
```

## 2. Créer le projet (région EU / RGPD)

Récupère ton organisation, puis crée le projet. Choisis un **mot de passe BDD
fort** et garde-le (il sert au `link` et à l'accès SQL direct) :

```powershell
pnpm exec supabase orgs list          # note l'ID d'org (ex. iaouquktvvfcewnxbtnu)

$dbpass = "RemplaceParUnMotDePasseFort!"   # ⚠️ valeur de session uniquement — jamais ton vrai mdp dans ce fichier versionné
pnpm exec supabase projects create catdesk-news --org-id TON_ORG_ID --region eu-central-1 --db-password $dbpass
```

`eu-central-1` = Francfort. La commande affiche le **project ref** (≈ 20 lettres) :
stocke-le dans `$ref`, il est réutilisé partout ci-dessous.

```powershell
$ref = "le_ref_affiché"
```

> Alternative : créer le projet depuis le dashboard (https://supabase.com/dashboard),
> région EU, puis reprendre à l'étape 3 avec le `<REF>` affiché dans l'URL.

## 3. Lier le repo au projet distant

```powershell
pnpm exec supabase link --project-ref $ref --password $dbpass
```

## 4. Appliquer le schéma (tables news + dailies + RLS + Realtime)

```powershell
pnpm exec supabase db push
```

> `db push` applique **toutes** les migrations du dossier — la table `news` et la
> table `dailies` ([20260629000000_dailies.sql](migrations/20260629000000_dailies.sql)).

Vérifie ensuite que la migration est bien marquée appliquée :

```powershell
pnpm exec supabase migration list
```

## 5. Activer l'auth anonyme côté distant

Notre `config.toml` a déjà `enable_anonymous_sign_ins = true`. On peut tenter de
le pousser :

```powershell
pnpm exec supabase config push
```

> ⚠️ **Bug connu CLI 2.108.0** : `config push` plante après l'étape Auth avec
> `failed to read Storage config: SchemaError(Missing key at ["databasePoolMode"])`.
> C'est un défaut du lecteur Storage du CLI (clé absente de la réponse API), sans
> rapport avec l'auth et non corrigeable via `config.toml`.
>
> **Voie fiable** : activer le réglage directement dans le dashboard —
> **Authentication → Sign In / Providers → Anonymous sign-ins** → *Save*.
> C'est le seul réglage auth nécessaire pour CatDesk ; pas besoin d'insister sur
> `config push`.

> ⚠️ **Captcha** : si la protection Captcha est activée (Authentication → Attack
> Protection), **désactive-la**. L'app n'envoie pas de `captcha_token`, donc et la
> connexion admin (`signInWithPassword`) et la lecture client (`signInAnonymously`)
> échouent avec `captcha protection: request disallowed`.

## 6. Renseigner les clés client (.env)

Récupère l'**URL** et la clé **anon / publishable** (publique, bornée par RLS) :

```powershell
pnpm exec supabase projects api-keys --project-ref $ref
```

Édite `apps/desktop/.env` (remplace par tes valeurs, sans chevrons) :

```
VITE_SUPABASE_URL=https://TON_REF.supabase.co
VITE_SUPABASE_ANON_KEY=la_clé_anon_ou_publishable
```

> ⚠️ Ne mets **jamais** la clé `service_role` / `sb_secret_…` dans l'app cliente.

## 7. Te donner le rôle admin (une seule fois)

Crée d'abord ton utilisateur (Dashboard → **Authentication → Add user**, ou un
sign-up), puis dans le **SQL Editor** du dashboard exécute (remplace l'email) :

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"admin"}'
where email = 'alexis.bert1412@gmail.com';
```

C'est ce claim `app_metadata.role = 'admin'` qui autorise l'écriture (policy
`news_admin_write`). Les clients (clé anon) ne peuvent que lire.

## 8. Vérifier

```powershell
pnpm dev
```

- Sans `.env` rempli : l'app démarre, news masquée (status `unconfigured`) — normal.
- Avec `.env` rempli : connexion anonyme OK. Publie une news de test
  (Dashboard → Table editor → `news` → Insert, `audience_client_id` vide = global)
  → le bandeau doit apparaître à l'ouverture chez tous les clients.

---

## Mises à jour de schéma ultérieures

```powershell
pnpm exec supabase migration new <nom>   # crée supabase/migrations/<timestamp>_<nom>.sql
# … écris ton SQL …
pnpm exec supabase db push               # applique au projet lié
```
