---
name: revue-comparee
description: Comparer le traitement d'un même sujet par plusieurs journaux — angles, désaccords, et ce qui n'est pas dit.
---

# Revue comparée

## Quand l'utiliser

Quand la question porte sur **plusieurs journaux à la fois** : « que disent les
journaux sur X », « sont-ils d'accord », « quels angles », « comparé à ».
Pour une question sur un seul article, `search_dailies` suffit — n'utilise pas
cette procédure.

## Procédure

1. `search_dailies` avec le sujet en `query`, `days: 2`, `limit: 6`.
   Ne mets pas `full_text: true` : les extraits pertinents suffisent et coûtent
   dix fois moins de contexte.
2. Regroupe les résultats **par journal**. Un journal absent du résultat est
   un journal qui n'a pas traité le sujet — c'est une information, pas un trou.
3. Pour chaque journal, relève **l'angle** en une phrase (ce qu'il met en avant).
4. Relève les **désaccords factuels** (chiffres, dates, attributions qui diffèrent).
   Un désaccord de chiffre se signale, il ne se tranche pas.
5. Termine par ce qu'**aucun** journal ne dit, si c'est notable.

## Format de réponse

Une phrase de synthèse, puis une ligne par journal (`Journal — angle`), puis les
désaccords s'il y en a. Cite toujours le journal et la date. Pas de tableau.

## Pièges

- Ne fabrique pas un désaccord pour équilibrer : si les journaux convergent, dis-le.
- Si `search_dailies` ne renvoie qu'un seul journal, dis-le et réponds sur ce seul
  journal plutôt que de faire semblant de comparer.
