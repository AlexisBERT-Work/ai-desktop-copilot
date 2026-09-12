# Distribuer CatDesk — installeur hors-ligne + mises à jour auto

Ce guide explique :

1. comment produire un **installeur Windows `.exe` 100 % autonome** (aucun Node,
   Python, Ollama ni internet requis chez le proche) ;
2. comment **pousser tes mises à jour** pour qu'elles arrivent automatiquement
   chez tous tes proches ;
3. comment garantir **zéro différence de fonctionnalités** entre ton PC et le leur.

> ⚠️ **Taille de l'installeur initial : ~18 Go** (v0.1.3, avec les trois modèles
> du bundle ; c'était ~22 Go avant le tri « un seul modèle »), **+ ~0,8 Go de
> modèles voix en 0.2.x**. La valeur exacte dépend des modèles présents dans
> `~/.ollama/models` au moment du build.
> Impossible par mail ou WeTransfer gratuit.
> Deux façons de le distribuer :
>
> - **§3bis (recommandé pour des proches non-techniques)** : un petit
>   `.exe` (~2 Mo) qui télécharge et installe tout seul, en silence — rien à
>   jongler, aucune commande à taper côté destinataire.
> - **clé USB / lien Drive-OneDrive** du gros installeur complet (§3), si tu
>   préfères transmettre le fichier toi-même.
>   (Les _mises à jour_, elles, sont légères dans les deux cas : voir plus bas.)

---

## 0. Architecture (à comprendre une fois)

| Sous-système    | Contenu bundlé                                                | Où ça vit chez le proche                                              |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Agent IA (Node) | `node.exe` + agent compilé (`dist/index.js`) + `node_modules` | dans l'app (mis à jour)                                               |
| Ollama          | `ollama.exe` (+ DLLs GPU/CPU)                                 | dans l'app (mis à jour)                                               |
| **Modèle LLM**  | blobs des modèles                                             | **dossier persistant** `%LOCALAPPDATA%\com.catdesk.app\ollama-models` |
| OCR / vision    | sidecar Python (PyInstaller) + données Tesseract              | dans l'app (mis à jour)                                               |
| Voix (0.2.x)    | modèles VAD + Parakeet + Piper (`voice/`, ~800 Mo)            | dans l'app (mis à jour — donc réexpédiés à chaque update, cf. note)   |

**Idée clé :** le modèle (lourd, immuable) est _séparé_ du code. Le gros
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

> Note voix : contrairement au modèle LLM, les modèles voix ne sont pas encore
> « semés » dans un dossier persistant — ils voyagent dans chaque artefact
> d'update (~800 Mo au lieu de 50–300). Piste dans
> [AMELIORATIONS.md](AMELIORATIONS.md) § 4.

---

## 0 bis. Deux lignes de distribution — à ne jamais croiser

Depuis 0.2.0 (voix, 2026-09), **deux lignes coexistent**, chacune avec son
propre dépôt de releases. La raison : l'URL d'auto-update est **cuite dans
chaque exe installé** et ne peut plus changer après coup.

| Ligne | Contenu               | Source git                                           | Dépôt de releases (endpoint updater) | État              |
| ----- | --------------------- | ---------------------------------------------------- | ------------------------------------ | ----------------- |
| 0.1.x | sans voix             | tag `v0.1.3` (= `master` avant la refonte d'août)    | `catdesk-releases`                   | **figée à 0.1.3** |
| 0.2.x | voix + refonte d'août | `refactor/etat-propre` → `master` une fois fusionnée | `catdesk-releases-voice`             | vivante           |

**La règle.** Une release marquée « latest » sur `catdesk-releases` avec une
version > 0.1.3 mettrait à jour **en silence, au lancement suivant**, tous
les exe 0.1.x installés — c'est exactement ce que la séparation empêche.
Donc :

- **jamais** de build 0.2.x publié sur `catdesk-releases` ;
- `publish-update.ps1` lit le dépôt cible dans l'endpoint de
  `tauri.release.conf.json` et **refuse** tout `-Repo` différent — c'est le
  garde-fou, ne pas le contourner ;
- pour corriger la ligne 0.1.x un jour : brancher depuis `v0.1.3`, garder
  l'endpoint `catdesk-releases`, publier 0.1.4. Les 0.2.x ne bougent pas
  (l'updater ne rétrograde jamais).

**À faire une fois** pour la ligne 0.2.x — créer le dépôt public :

```powershell
gh repo create AlexisBERT-Work/catdesk-releases-voice --public `
  --description "CatDesk 0.2.x (voix) — installeurs et mises à jour"
```

Tant qu'il n'existe pas, un exe 0.2.x logue un 404 à chaque lancement et ne
se met pas à jour, sans autre effet.

Deux précisions : installer la 0.2.x sur un poste qui a la 0.1.x **la
remplace** (même `AppId` Inno, même identifiant Tauri) — les deux lignes ne
cohabitent pas sur une même machine ; et le bootstrap (§3bis) porte la
version, le dépôt et le nombre de tranches (`PartCount`) de **sa** ligne :
vérifier `PartCount` après chaque build complet, les ~800 Mo de voix peuvent
ajouter une tranche.

---

## 1. Parité de fonctionnalités — pulle TOUS les modèles d'abord

L'agent utilise **3 modèles**. Pour que tes proches aient exactement les mêmes
capacités que toi, pulle-les **avant** de builder (le build copie tout
`~/.ollama/models`) :

```powershell
ollama pull qwen3:14b         # modèle de chat UNIQUE (CATDESK_MODEL)
ollama pull minicpm-v         # vision / "décris mon écran"
ollama pull nomic-embed-text  # mémoire sémantique / recherche
```

> Sans `minicpm-v` la vision écran tombe en panne silencieuse ; sans
> `nomic-embed-text` la recherche sémantique retombe sur un repli mots-clés.
> Le build via `stage-curated-models.ps1` n'embarque QUE ces 3 modèles (le
> un modèle plus petit a été retiré du bundle depuis la v0.1.3) → parité garantie.

Pour **alléger** : supprime ce qui ne sert pas. NB : depuis le tri 2026-07-20,
`qwen2.5-coder:14b` n'est plus dans le lineup embarqué (bot sans codage) — si
ton `~/.ollama` local le contient encore, il est ignoré au staging :

```powershell
ollama list
ollama rm qwen2.5-coder:14b   # si présent depuis une version < 0.1.3   # option : libérer 9 Go sur TON poste de dev
```

---

## 2. Prérequis sur TON PC (le PC de build)

- Node ≥ 22, pnpm ≥ 11.3, Rust ≥ 1.96 (toolchain de dev habituelle)
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
champ `plugins.updater.pubkey`, à la place de `la valeur actuelle de plugins.updater.pubkey`.

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
dist-installer/CatDesk-<version>-offline-setup.exe (+ .bin si disque-spanné)
```

C'est CE fichier que tu donnes à tes proches (USB / Drive). Installation **par
utilisateur** (pas d'admin), dans `%LOCALAPPDATA%`.

> SmartScreen affichera « éditeur inconnu » (exe non signé par un certificat de
> code) → « Informations complémentaires » → « Exécuter quand même ». Voir §6.

---

## 3bis. Distribution en un clic (bootstrap auto-téléchargeur)

Pour des proches **pas du tout techniques** : pas de dossier à garder groupé,
pas de commande, pas même besoin d'expliquer où mettre le fichier. Tu leur
donnes **un seul petit `.exe`** (~2 Mo) — par mail, Discord, WhatsApp, Drive,
peu importe puisqu'il est minuscule. Double-clic → il télécharge tout seul le
vrai installeur (~18 Go, en tâche de fond avec barre de progression) → il
l'installe en silence → CatDesk se lance.

### Comment ça marche

`scripts/catdesk-bootstrap.iss` compile un installeur Inno Setup **vide de
payload** : à l'étape `ssInstall`, son `[Code]` Pascal télécharge (PowerShell
natif `Invoke-WebRequest`, `-UseBasicParsing` + `$ProgressPreference =
'SilentlyContinue'`, 3 tentatives avec pause) les 13 fichiers déjà validés du
§3 (`dist-installer/CatDesk-<version>-offline-setup-N.bin` + `.exe`) depuis une
release GitHub **publique** dédiée, dans un dossier temporaire, puis lance le
vrai installeur en `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART` et nettoie
derrière lui. `Uninstallable=no` évite qu'il crée sa propre entrée dans
Ajout/Suppression de programmes (seul le vrai CatDesk installé ensuite en a
une).

Le payload est hébergé sur un repo GitHub **séparé et public**,
[`catdesk-releases`](https://github.com/AlexisBERT-Work/catdesk-releases) —
volontairement distinct du repo source privé, pour ne jamais exposer le code
tout en permettant un téléchargement anonyme (Releases GitHub ne demandent pas
d'authentification pour télécharger un asset d'une release publique).

### Publier une nouvelle version du payload

1. Build l'installeur complet comme au §3 (`scripts/build-release.ps1` puis
   `scripts/build-inno.ps1`) → les 13 fichiers dans `dist-installer/`.
2. Crée (ou réutilise) une release sur **le dépôt de la ligne** (§0 bis —
   `catdesk-releases-voice` pour 0.2.x) et uploade-les :
   ```powershell
   gh release create v0.2.0 --repo AlexisBERT-Work/catdesk-releases-voice `
     --title "CatDesk 0.2.0" --notes "..." dist-installer/*.bin dist-installer/*.exe
   gh release edit v0.2.0 --repo AlexisBERT-Work/catdesk-releases-voice --draft=false
   ```
   > Une release fraîchement créée reste en **draft** tant qu'elle n'est pas
   > publiée explicitement — un asset "uploadé" sur un brouillon n'est PAS
   > accessible publiquement tant que `--draft=false` n'a pas été appliqué.
3. Mets à jour dans `scripts/catdesk-bootstrap.iss` : `MyAppVersion`,
   `BaseName` (contient la version) et le tag dans `BaseUrl`.
4. Recompile (`ISCC scripts/catdesk-bootstrap.iss`, sans override) →
   `dist-bootstrap/CatDesk-Installer.exe`. **C'est ce fichier-là** que tu
   donnes à tes proches.

### Tester en local avant publication

Surcharger `BaseUrl` pour pointer sur un serveur local (`python -m
http.server`) évite de re-télécharger ~18 Go à chaque test :

```powershell
ISCC /DBaseUrl=http://127.0.0.1:8000 scripts/catdesk-bootstrap.iss
```

---

## 4. Publier une mise à jour (à chaque changement)

Une fois la clé en place (§2.1) et la clé privée dans l'environnement :

```powershell
# Charger la clé privée + son mot de passe dans le shell courant
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$HOME\.tauri\catdesk.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<mot de passe de la clé>"

# Publier la version 0.2.1
pwsh -File scripts/publish-update.ps1 -Version 0.2.1 -Notes "Nouveau: outil X, fix Y"
```

Le script :

1. lit le dépôt cible dans l'endpoint updater de `tauri.release.conf.json`
   (§0 bis) — un `-Repo` différent est refusé ;
2. bumpe la version dans `tauri.conf.json` ;
3. build un **artefact de mise à jour** (sans le modèle LLM) et le signe ;
4. génère `latest.json` (le manifeste que lisent les apps) ;
5. crée la **release GitHub** `v0.2.1` et y uploade l'installeur + `latest.json`.

Les apps de tes proches vérifient
`releases/latest/download/latest.json` **du dépôt de leur ligne, à chaque
lancement**, et se mettent à jour toutes seules. Aucun re-téléchargement du
modèle LLM.

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

- **RAM/VRAM.** `qwen3:14b` (~9 Go) est le modèle unique : compte ~10 Go de VRAM
  pour le garder résident (sinon débordement RAM — lent mais cohérent). Machine
  très contrainte → pull manuellement un modèle plus petit et impose-le via `CATDESK_MODEL_SMALL`.
- **GPU.** Ollama utilise le GPU si présent, sinon CPU (plus lent, mais marche
  partout). Les DLLs bundlées viennent de ton PC ; le repli CPU fonctionne.
- **Signature SmartScreen.** Pour supprimer l'avertissement « éditeur inconnu »,
  il faut un **certificat de signature de code** (payant, ~100–300 €/an) puis
  renseigner `bundle.windows.certificateThumbprint`. La signature _updater_
  (§2.1) est différente et gratuite — elle sécurise les mises à jour, pas l'UAC.
- **OCR.** `-SkipOcr` désactive proprement capture/OCR écran (l'agent ne reçoit
  pas `OCR_SIDECAR_BIN`). Pour la parité, ne l'utilise pas.

---

## 7. Dépannage

| Symptôme                                             | Cause probable                                                  | Fix                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm --filter @catdesk/agent-runtime deploy` échoue | workspace non résolu                                            | le script retente avec `--legacy` ; sinon `pnpm install` puis relancer                            |
| L'IA ne répond pas chez le proche                    | modèle absent / mauvais nom                                     | vérifier que `%LOCALAPPDATA%\com.catdesk.app\ollama-models` contient le modèle de `CATDESK_MODEL` |
| Vision / "décris l'écran" muet                       | `minicpm-v` pas pullé au build                                  | `ollama pull minicpm-v` puis rebuild installeur                                                   |
| Les updates ne s'installent pas                      | version non incrémentée, ou pubkey/clé qui ne correspondent pas | bumper la version ; vérifier que la pubkey du conf vient de la même clé que celle de signature    |
| `.sig` manquant au build update                      | env de signature absent                                         | définir `TAURI_SIGNING_PRIVATE_KEY` + `..._PASSWORD` avant `publish-update.ps1`                   |
| Fenêtre console qui apparaît                         | flag `CREATE_NO_WINDOW` manquant                                | déjà géré dans bridge.rs / ollama.rs                                                              |
