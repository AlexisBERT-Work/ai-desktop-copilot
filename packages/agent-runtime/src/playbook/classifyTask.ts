/**
 * Cheap, deterministic task-type classifier (CATDESK-CONCEPTS-AVANCES §8).
 * Maps a user request to a coarse task type so the playbook can index which
 * approaches worked per type. No LLM — keyword/regex rules, FR + EN.
 *
 * Returns 'general' when nothing matches. First match wins, so order = priority.
 */
export type TaskType =
  | 'debug' | 'tests' | 'refactor' | 'git' | 'search' | 'explain' | 'write' | 'general';

const RULES: ReadonlyArray<{ type: TaskType; re: RegExp }> = [
  { type: 'debug', re: /\b(debug|d[ée]bogu\w*|bug|stack\s?trace|stacktrace|crash\w*|exception|erreur|error|plante|ne marche pas|fix\w*|corrig\w*)\b/i },
  { type: 'tests', re: /\b(tests?|teste\w*|testing|couverture|coverage|unit\s?tests?|vitest|jest|pytest)\b/i },
  { type: 'refactor', re: /\b(refactor\w*|refacto\w*|restructur\w*|nettoie\w*|clean\s?up|simplifi\w*|renomm\w*|rename)\b/i },
  { type: 'git', re: /\b(git|commit\w*|branche?s?|merge\w*|rebase\w*|\bPR\b|pull\s?request|diff|stash|cherry-?pick)\b/i },
  { type: 'search', re: /\b(cherche\w*|trouve\w*|recherche\w*|search|find|o[uù] (est|se trouve)|localis\w*|grep)\b/i },
  { type: 'explain', re: /\b(explique\w*|expliqu\w*|comprend\w*|pourquoi|comment (?:ça|ca|cela) marche|what is|how does|qu['e]est-ce)\b/i },
  { type: 'write', re: /\b(r[ée]dige\w*|[ée]cris\w*|write|documente\w*|document\w*|r[ée]sume\w*|summari[sz]e|g[ée]n[èe]re\w* (?:du|le|un) (?:texte|article|doc))\b/i },
];

export function classifyTask(input: string): TaskType {
  const text = input ?? '';
  for (const { type, re } of RULES) {
    if (re.test(text)) return type;
  }
  return 'general';
}
