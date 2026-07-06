# CatDesk — Choix de modèle & amélioration continue

> Config matériel cible : **GPU 12-16 GB VRAM**
> Objectif : meilleur modèle local + système qui s'améliore avec le temps
> Complément de `CATDESK-CONCEPTS-AVANCES.md` (§3 mémoire, §5 inférence, §8 auto-amélioration)

---

## TL;DR

1. Remplace Qwen 2.5 par **Devstral Small 24B** comme cerveau principal.
2. Garde un **petit modèle** (Qwen3 8B) pour les tâches triviales → routage.
3. Le modèle ne "s'améliore" pas seul (poids figés). C'est le **système autour**
   (mémoire + playbook + skills) qui apprend. C'est la vraie réponse à "s'améliore avec le temps".

---

## 1. Le modèle principal

### Pourquoi changer

Si tu tournes encore sur Qwen 2.5, tu es une génération derrière. En 2026, le trio de
référence en local est Qwen 3.6 / DeepSeek V4 / Gemma 4.

### Choix recommandé pour 12-16 GB VRAM

| Modèle | Profil | VRAM (Q4_K_M) | Commande |
|---|---|---|---|
| **Devstral Small 24B** ⭐ | Coding agentique : édits multi-fichiers, boucles de debug | ~16 GB | `ollama pull devstral-small:24b` |
| **Qwen 3.6 27B** | Meilleure qualité dense (77,2% SWE-bench), serré sur 16 GB | ~20-22 GB | `ollama pull qwen3.6:27b` |
| **Codestral 22B** | Autocomplete FIM dans l'IDE (alternative Copilot) | ~14 GB | `ollama pull codestral:22b` |
| **Qwen3 14B** | Repli si seulement 12 GB | ~10 GB | `ollama pull qwen3:14b` |

**Recommandation** :
- **16 GB** → Devstral Small 24B en Q4_K_M (cerveau principal de CatDesk).
- **12 GB** → Qwen3 14B, ou Devstral en quantification plus agressive (Q3).

### Pourquoi Devstral pour CatDesk

- Conçu pour le **coding agentique** (multi-fichiers, debug en boucle) = ton cas d'usage exact.
- Les familles Qwen3 / Devstral ont le **tool calling le plus stable** : ils hallucinent
  rarement des appels d'outils ou ne perdent pas de paramètres. Crucial pour un agent
  qui appelle des outils en boucle.

### Le seuil critique : tout en VRAM

À Q4_K_M : 14B ≈ 10 GB · 24B ≈ 16 GB · 32B ≈ 20-22 GB.
**Si le modèle tient entièrement en VRAM, il tourne 5-10x plus vite** que s'il déborde sur
la RAM système. Ne prends jamais un modèle qui déborde — préfère un modèle plus petit
entièrement chargé.

### Attente réaliste (sans illusion)

Le local ne battra pas le cloud sur les refactos multi-fichiers cross-repo les plus durs.
Mais il gère **80%+ du travail quotidien** : édits simples, fixs de bugs, génération de
tests, boilerplate, explication, refacto. C'est la barre réaliste.

---

## 2. Routage multi-modèles (économie VRAM + vitesse)

Ne fais pas tourner le gros modèle pour tout. Charge un petit modèle pour les tâches
triviales et route vers le gros seulement si nécessaire.

```
~/.catdesk/models.toml
```

```toml
# Config de routage des modèles CatDesk

[models.small]
name = "qwen3:8b"           # classification d'intention, extraction, résumés courts
vram_gb = 6
keep_alive = "30m"

[models.main]
name = "devstral-small:24b" # code courant, agentique, tool calling
vram_gb = 16
keep_alive = "30m"

[models.embed]
name = "nomic-embed-text"   # embeddings pour le RAG (couche semantic)
vram_gb = 1
keep_alive = "60m"

[routing]
# Règles : quelle complexité → quel modèle
trivial  = "small"   # "classe cette intention", "résume ce diff court"
standard = "main"    # "écris cette fonction", "analyse ce stacktrace"
hard     = "main"    # (pas de plus gros modèle qui tienne en 16 GB)
```

Logique de routage côté harness (rappel du §5 des concepts) :

```rust
fn route_model(task: &Task) -> ModelChoice {
    match task.complexity() {
        Complexity::Trivial  => ModelChoice::Small,  // qwen3:8b
        Complexity::Standard => ModelChoice::Main,   // devstral-small:24b
        Complexity::Hard     => ModelChoice::Main,
    }
}
```

> ⚠️ Sur 16 GB tu ne peux pas garder le 24B **et** le 8B chauds en même temps. Deux options :
> - Charger le petit à la demande (léger, recharge rapide).
> - Ou ne garder que le 24B chaud et faire les tâches triviales avec lui aussi (plus simple).
> Commence simple : un seul modèle chaud (Devstral) + embeddings. Ajoute le routage quand
> tu mesures un vrai besoin.

---

## 3. Réglages d'inférence (vitesse gratuite)

### keep_alive — garder le modèle chaud

Évite le rechargement entre deux requêtes (gros gain de latence perçue).

```bash
# Au lancement, pré-charge et garde chaud 30 min
curl http://localhost:11434/api/generate -d '{
  "model": "devstral-small:24b",
  "keep_alive": "30m"
}'
```

Ou variable d'environnement globale Ollama :

```bash
# Garde tous les modèles chauds par défaut
export OLLAMA_KEEP_ALIVE=30m
```

### Autres leviers (voir CONCEPTS §5 pour le détail)

| Levier | Gain | Quand |
|---|---|---|
| `keep_alive` | Latence perçue | Tout de suite |
| Routage de modèles | VRAM + vitesse | Quand tu as 2 modèles |
| Semantic cache | jusqu'à -70% d'appels | Phase 2 |
| Speculative decoding | ~1.5-2x | Selon support Ollama |
| KV cache 4-bit | -50% RAM contexte | Avancé, long contexte |

---

## 4. "S'améliorer avec le temps" — les 3 voies réelles

> Point clé : **les poids d'un LLM local sont figés**. `ollama pull` télécharge un fichier
> qui ne change jamais en l'utilisant. Voici les vraies façons d'obtenir l'effet recherché.

### Voie A — Le système apprend (RECOMMANDÉ) ⭐

Le modèle reste le même, mais CatDesk accumule mémoire + stratégies + skills.
**C'est ça, le vrai "s'améliore avec le temps"**, et ça marche avec n'importe quel modèle,
sans GPU d'entraînement. Détaillé dans `CATDESK-CONCEPTS-AVANCES.md` :

- **§3 Mémoire hiérarchique** : warm (faits/préférences), episodic (trajectoires), semantic
  (vector). Daemon de consolidation nocturne.
- **§8 Auto-amélioration** :
  - **Playbook** : table `strategies(task_type, approach, success_rate)` consultée avant
    chaque tâche.
  - **Traces structurées** : chaque tour journalisé (input, plan, tools, résultat, succès).
  - **Daemon d'évolution** : analyse les traces, repère les échecs récurrents, propose des
    ajustements (validés par toi).
  - **Auto-génération de skills** : une trace réussie généralisable → brouillon de `SKILL.md`.

C'est l'option à prioriser. Effort raisonnable, gain réel et cumulatif.

### Voie B — Fine-tuning LoRA (avancé, optionnel)

Tu peux réellement modifier les poids en entraînant un **adaptateur LoRA** sur tes propres
données (ton code, tes conventions de nommage, tes patterns).

- ✅ Modifie vraiment le comportement du modèle vers ton style.
- ❌ Demande un pipeline d'entraînement + données propres étiquetées.
- ❌ Fige à nouveau une fois fait (pas continu).
- ❌ Lourd pour un gain incertain dans ton cas.

**Verdict** : à garder en tête, pas en priorité. La voie A donne 80% du bénéfice pour 20%
de l'effort.

### Voie C — Upgrade passif

Re-pull quand une meilleure version sort. Qwen 3.7-Max est sorti en API le 20 mai 2026 ;
les poids ouverts 27B/35B sont attendus juin-juillet 2026. Surveille ce créneau.

```bash
# Vérifier les versions dispo avant de pull
# → ollama.com/library/qwen3
ollama pull qwen3.7:27b   # exemple, quand dispo
ollama list                # voir ce qui est installé
ollama rm qwen2.5:32b      # nettoyer l'ancien
```

---

## 5. Plan d'action

```
Étape 1 (aujourd'hui)
  └─ ollama pull devstral-small:24b
  └─ export OLLAMA_KEEP_ALIVE=30m
  └─ Tester comme cerveau principal de CatDesk
     → comparer le tool calling vs Qwen 2.5 (le saut devrait être net)

Étape 2 (cette semaine)
  └─ ollama pull nomic-embed-text   (embeddings RAG)
  └─ Brancher Devstral dans le harness existant
  └─ Mesurer tokens/sec et VRAM réelle (ollama ps)

Étape 3 (amélioration continue — voie A)
  └─ Mémoire warm SQLite (faits + préférences)
  └─ Traces structurées (enrichir l'audit existant)
  └─ Playbook des stratégies
  └─ Daemon de consolidation + évolution nocturne

Étape 4 (optionnel, plus tard)
  └─ Routage 2 modèles si besoin mesuré
  └─ Semantic cache
  └─ Surveiller la sortie des poids Qwen 3.7 ouverts
```

---

## Récapitulatif des commandes

```bash
# Installer le modèle principal
ollama pull devstral-small:24b

# Modèle d'embeddings pour le RAG
ollama pull nomic-embed-text

# (Optionnel) petit modèle pour le routage
ollama pull qwen3:8b

# Garder les modèles chauds
export OLLAMA_KEEP_ALIVE=30m

# Diagnostics
ollama list        # modèles installés
ollama ps          # modèles chargés + VRAM utilisée
ollama --version   # noter avant tout benchmark
```

---

_Sources : benchmarks LiveBench / SWE-bench juin 2026, comparatifs Ollama 2026
(Morph, PromptQuorum, InsiderLLM). Les versions de modèles évoluent vite — vérifie
`ollama.com/library` avant chaque pull._
