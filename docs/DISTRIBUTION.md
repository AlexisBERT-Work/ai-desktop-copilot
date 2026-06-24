# Distribuer CatDesk — installeur hors-ligne + mises à jour auto

Ce guide explique :
1. comment produire un **installeur Windows `.exe` 100 % autonome** (aucun Node,
   Python, Ollama ni internet requis chez le proche) ;
2. comment **pousser tes mises à jour** pour qu'elles arrivent automatiquement
   chez tous tes proches ;
3. comment garantir **zéro différence de fonctionnalités** entre ton PC et le leur.

> ⚠️ **Taille de l'installeur initial.** Il embarque le(s) modèle(s) LLM
> (plusieurs Go) → **5 à 12 Go**. Impossible par mail/WeTransfer gratuit →
> **clé USB** ou **lien Google Drive / OneDrive**. (Les *mises à jour*, elles,
> sont légères : voir plus bas.)

---

## 0. Architecture (à comprendre une fois)

| Sous-système | Contenu bundlé | Où ça vit chez le proche |
|---|---|---|
| Agent IA (Node) | `node.exe` + agent compilé (`dist/index.js`) + `node_modules` | dans l'app (mis à jour) |
| Ollama | `ollama.exe` (+ DLLs GPU/CPU) | dans l'app (mis à jour) |
| **Modèle LLM** | blobs des modèles | **dossier persistant** `%LOCALAPPDATA%\com.catdesk.app\ollama-models` |
| OCR / vision | sidecar Python (PyInstaller) + données Tesseract | dans l'app (mis à jour) |

**Idée clé :** le modèle (lourd, immuable) est *séparé* du code. Le gros
installeur initial le « sème » une fois dans le dossier persistant
([ollama.rs](../apps/desktop/src-tauri/src/core/ollama.rs) → `seed_models`).
Ensuite, **les mises à jour ne transportent que le code** (≈ 50–300 Mo), jamais
le modèle. C'est ce qui rend l'auto-update viable.

Au lancement, le cœur Rust :
1. sème le modèle dans le dossier persistant (1ʳᵉ fois seulement) ;
2. démarre l'Ollama embarqué en pointant `OLLAMA_MODELS` dessus (ou réutilise un
   Ollama déjà présent sur :11434) ;
3. lance l'agent Node bundlé ;
4. vérifie GitHub Releases et **s'auto-met à jour en silence** si une nouvelle
   version signée existe ([updater.rs](../apps/desktop/src-tauri/src/core/updater.rs)).

---

## 1. Parité de fonctionnalités — pulle TOUS les modèles d'abord

L'agent utilise **3 modèles**. Pour que tes proches aient exactement les mêmes
capacités que toi, pulle-les **avant** de builder (le build copie tout
`~/.ollama/models`) :

```powershell
ollama pull qwen2.5:7b        # principal (CATDESK_MODEL) — déjà présent
ollama pull llava:7b          # vision / "décris mon écran"
ollama pull nomic-embed-text  # mémoire sémantique / recherche
```

> Sans `llava:7b` la vision écran tombe en panne silencieuse ; sans
> `nomic-embed-text` la recherche sémantique retombe sur un repli mots-clés.
> Comme le build embarque ce que TU as pullé, ces 3 modèles garantissent la
> parité.

Pour **alléger** : supprime ce qui ne sert pas (ex. le gros modèle code) :
```powershell
ollama list
ollama rm qwen2.5-coder:14b   # ex. retirer 9 Go inutiles pour tes proches
```

---

## 2. Prérequis sur TON PC (le PC de build)

- Node ≥ 20, pnpm ≥ 9, Rust ≥ 1.78 (toolchain de dev habituelle)
- **Ollama** installé avec les modèles pullés (étape 1)
- Pour l'OCR : le venv Python `packages/ocr-vision/.venv` (`scripts/setup.ps1`).
  Le script installe `pyinstaller` automatiquement.
- `gh` CLI authentifié (`gh auth status`) — pour publier les mises à jour.

### 2.1 Clé de signature des mises à jour (UNE SEULE FOIS)

L'auto-update n'accepte que des builds **signés**. Génère une paire de clés :

```powershell
pnpm --filter @catdesk/desktop exec tauri signer generate -w "$HOME\.tauri\catdesk.key"
```

Cela crée `catdesk.key` (privée, **à garder secrète**) + affiche la **clé
publique**. Colle la clé publique dans
[tauri.release.conf.json](../apps/desktop/src-tauri/tauri.release.conf.json),
champ `plugins.updater.pubkey`, à la place de `PASTE_YOUR_TAURI_UPDATER_PUBLIC_KEY_HERE`.

> ⚠️ Si tu perds cette clé privée, tu ne pourras plus jamais publier de mise à
> jour acceptée par les apps déjà installées. Sauvegarde-la.

---

## 3. Construire l'installeur initial (à distribuer une fois)

```powershell
# Build complet hors-ligne (agent + Ollama + modèles + OCR)
pwsh -File scripts/build-release.ps1

# Variante sans OCR (plus léger/rapide)
pwsh -File scripts/build-release.ps1 -SkipOcr

# Avec un dossier de modèles spécifique
pwsh -File scripts/build-release.ps1 -ModelsPath "D:\mes-modeles-ollama"
```

Résultat :
```
apps/desktop/src-tauri/target/release/bundle/nsis/CatDesk_<version>_x64-setup.exe
```

C'est CE fichier que tu donnes à tes proches (USB / Drive). Installation **par
utilisateur** (pas d'admin), dans `%LOCALAPPDATA%`.

> SmartScreen affichera « éditeur inconnu » (exe non signé par un certificat de
> code) → « Informations complémentaires » → « Exécuter quand même ». Voir §6.

---

## 4. Publier une mise à jour (à chaque changement)

Une fois la clé en place (§2.1) et la clé privée dans l'environnement :

```powershell
# Charger la clé privée + son mot de passe dans le shell courant
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$HOME\.tauri\catdesk.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<mot de passe de la clé>"

# Publier la version 0.1.1
pwsh -File scripts/publish-update.ps1 -Version 0.1.1 -Notes "Nouveau: outil X, fix Y"
```

Le script :
1. bumpe la version dans `tauri.conf.json` ;
2. build un **artefact de mise à jour léger** (sans le modèle) et le signe ;
3. génère `latest.json` (le manifeste que lisent les apps) ;
4. crée la **release GitHub** `v0.1.1` et y uploade l'installeur + `latest.json`.

Les apps de tes proches vérifient
`releases/latest/download/latest.json` **à chaque lancement** et se mettent à
jour toutes seules. Aucun re-téléchargement du modèle.

> Pense à committer le bump de version (`tauri.conf.json`) après publication.
> La version DOIT augmenter à chaque update sinon les clients ne bougent pas.

---

## 5. Côté proche (résumé)

1. Reçoit le `.exe` initial → installe (pas d'admin).
2. 1ᵉʳ lancement : le modèle est « semé » (quelques secondes), Ollama démarre,
   `Ctrl+Espace` ouvre la bulle.
3. À chaque lancement suivant : si tu as publié une update, elle s'installe en
   silence et l'app redémarre sur la nouvelle version. Rien à faire pour lui.

---

## 6. Limites & notes

- **RAM.** `qwen2.5:7b` ≈ 6–8 Go libres, et c'est le plancher du lineup (le
  `qwen2.5:3b` a été abandonné pour son français cassé). Machine très contrainte →
  pull manuellement un modèle plus petit et mets-le en `CATDESK_MODEL`.
- **GPU.** Ollama utilise le GPU si présent, sinon CPU (plus lent, mais marche
  partout). Les DLLs bundlées viennent de ton PC ; le repli CPU fonctionne.
- **Signature SmartScreen.** Pour supprimer l'avertissement « éditeur inconnu »,
  il faut un **certificat de signature de code** (payant, ~100–300 €/an) puis
  renseigner `bundle.windows.certificateThumbprint`. La signature *updater*
  (§2.1) est différente et gratuite — elle sécurise les mises à jour, pas l'UAC.
- **OCR.** `-SkipOcr` désactive proprement capture/OCR écran (l'agent ne reçoit
  pas `OCR_SIDECAR_BIN`). Pour la parité, ne l'utilise pas.

---

## 7. Dépannage

| Symptôme | Cause probable | Fix |
|---|---|---|
| `pnpm deploy` échoue | workspace non résolu | le script retente avec `--legacy` ; sinon `pnpm install` puis relancer |
| L'IA ne répond pas chez le proche | modèle absent / mauvais nom | vérifier que `%LOCALAPPDATA%\com.catdesk.app\ollama-models` contient le modèle de `CATDESK_MODEL` |
| Vision / "décris l'écran" muet | `llava:7b` pas pullé au build | `ollama pull llava:7b` puis rebuild installeur |
| Les updates ne s'installent pas | version non incrémentée, ou pubkey/clé qui ne correspondent pas | bumper la version ; vérifier que la pubkey du conf vient de la même clé que celle de signature |
| `.sig` manquant au build update | env de signature absent | définir `TAURI_SIGNING_PRIVATE_KEY` + `..._PASSWORD` avant `publish-update.ps1` |
| Fenêtre console qui apparaît | flag `CREATE_NO_WINDOW` manquant | déjà géré dans bridge.rs / ollama.rs |
