/**
 * Politique de blocage des commandes système — source de vérité unique côté Node
 * (docs/SECURITE.md, Vuln 4). Utilisée par run_command.
 *
 * ⚠️ Une deny-list n'est PAS une frontière de sécurité : elle ne remplace pas la
 * confirmation `high` de run_command. Son rôle est d'attraper les schémas les plus
 * destructeurs/évasifs évidents, pas d'être exhaustive. On couvre néanmoins les
 * contournements documentés (abréviations PowerShell, alias, cmdlets de download).
 */

export const MAX_COMMAND_LEN = 2048;

const BLOCKED_PATTERNS: readonly RegExp[] = [
  // Destruction de fichiers / système
  /rm\s+-[rf]{1,2}\s+\//i, // rm -rf /, rm -fr /, rm -r /
  /\bremove-item\b[\s\S]*?-(?:recurse|r)\b/i, // équivalent PowerShell de rm -rf
  /format\s+[a-z]:/i,
  /\bdel\s+\/[sfq]/i, // del /s /f /q
  /\brd\s+\/s/i, // rd /s
  /shutdown\s*\//i,
  /reg\s+delete\s+hklm/i,
  /\bbcdedit\b/i,
  /\bdiskpart\b/i,

  // Exécution encodée / évasion PowerShell.
  // -e, -en, -enc … sont tous des préfixes valides de -EncodedCommand.
  /\bpowershell(?:\.exe)?\b[\s\S]*?\s-e(?:n(?:c(?:o(?:d(?:e(?:d(?:c(?:o(?:m(?:m(?:a(?:nd?)?)?)?)?)?)?)?)?)?)?)?)?\b/i,
  /-(?:executionpolicy\s+)?bypass\b/i,

  // Invoke-Expression et son alias iex (avec ou sans parenthèse)
  /\binvoke-expression\b/i,
  /\biex\b/i,

  // Téléchargement + exécution (drive-by)
  /\b(?:invoke-webrequest|invoke-restmethod|iwr|irm|downloadstring|downloadfile|downloaddata|start-bitstransfer)\b/i,
];

/** Renvoie true si la commande doit être bloquée par la politique de sécurité. */
export function isCommandBlocked(command: string): boolean {
  return BLOCKED_PATTERNS.some(p => p.test(command));
}
