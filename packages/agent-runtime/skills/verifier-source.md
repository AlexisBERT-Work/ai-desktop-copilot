---
name: verifier-source
description: Vérifier une information en remontant à la source primaire avant de l'affirmer.
---

# Vérifier une source

## Quand l'utiliser

Quand on te demande si une information est **fiable**, de **vérifier** un chiffre,
ou de **remonter à la source**. Aussi quand tu t'apprêtes à affirmer un chiffre
précis que tu n'as vu que dans un résumé.

## Procédure

1. `search_dailies` sur les termes de l'affirmation, pour retrouver l'article
   d'origine et son journal.
2. Si la daily cite une URL, `read_webpage` dessus. Le champ `extraction` du
   résultat te dit d'où vient le texte : `trafilatura` ou `heuristique` = contenu
   d'article débruité ; `brut` = la page n'avait pas de prose identifiable
   (paywall, mur de cookies) — dans ce cas le texte contient du menu et de la
   navigation, ne cite rien qui vienne de là.
3. Compare le chiffre annoncé au chiffre de la source. Trois issues seulement :
   **confirmé**, **contredit**, ou **introuvable**.

## Règle absolue

N'affirme **jamais** un chiffre que tu n'as pas vu dans la source primaire.
« Je ne retrouve pas ce chiffre dans la source » est une réponse correcte et
utile ; l'inventer ne l'est pas.

## Format de réponse

Verdict en premier mot (Confirmé / Contredit / Introuvable), puis la source
(journal + date, URL si disponible), puis l'écart s'il y en a un.
