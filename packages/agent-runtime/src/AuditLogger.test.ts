import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLogger } from './AuditLogger';
import { redactArgs } from './security/redactArgs';

describe('redactArgs', () => {
  it('masque les secrets par nom de clé, quel que soit l’outil', () => {
    expect(
      redactArgs({
        host: 'imap.example.org',
        user: 'moi',
        password: 'hunter2',
        token: 'ghp_x',
        connection_string: 'postgres://u:p@h/db',
        webhook_url: 'https://discord.com/api/webhooks/1/secret',
        api_key: 'k',
      }),
    ).toEqual({
      host: 'imap.example.org',
      user: 'moi',
      password: '[REDACTED]',
      token: '[REDACTED]',
      connection_string: '[REDACTED]',
      webhook_url: '[REDACTED]',
      api_key: '[REDACTED]',
    });
  });

  it('ne garde que la taille des contenus (fichier, saisie navigateur, corps)', () => {
    expect(redactArgs({ path: 'C:/x.txt', content: 'abcd' })).toEqual({
      path: 'C:/x.txt',
      content: '[4 chars]',
    });
    expect(redactArgs({ selector: '#pwd', text: 'motdepasse' })).toEqual({
      selector: '#pwd',
      text: '[10 chars]',
    });
  });

  it('masque les en-têtes sensibles de call_api', () => {
    expect(
      redactArgs({ headers: { Authorization: 'Bearer abc', Accept: 'application/json' } }),
    ).toEqual({ headers: { Authorization: '[REDACTED]', Accept: 'application/json' } });
  });
});

describe('AuditLogger', () => {
  let dir = '';
  let prev: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'catdesk-audit-'));
    prev = process.env['CATDESK_DATA_DIR'];
    process.env['CATDESK_DATA_DIR'] = dir;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env['CATDESK_DATA_DIR'];
    else process.env['CATDESK_DATA_DIR'] = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it('écrit des lignes JSON expurgées dans audit/audit-<jour>.log', () => {
    const audit = new AuditLogger(() => new Date('2026-10-07T10:00:00Z'));
    audit.logToolCall(
      'run-1',
      'read_email',
      { user: 'moi', password: 'hunter2' },
      {
        success: false,
        error: 'auth',
      },
    );

    const lines = readFileSync(join(dir, 'audit', 'audit-2026-10-07.log'), 'utf8')
      .trim()
      .split('\n')
      .map(l => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: 'TOOL_CALL',
      tool: 'read_email',
      args: { user: 'moi', password: '[REDACTED]' },
      success: false,
      error: 'auth',
    });
    expect(JSON.stringify(lines)).not.toContain('hunter2');
  });

  it('PERMISSION note la portée de l’accord (cette fois / ce site) et le site', () => {
    const audit = new AuditLogger(() => new Date('2026-11-21T10:00:00Z'));
    audit.logPermission('run-1', 'browser_click', {
      granted: true,
      reason: "Autorisé par l'utilisateur",
      scope: 'site',
      site: 'exemple.fr',
      requestId: 'req-1',
    });
    audit.logPermission('run-1', 'browser_click', {
      granted: true,
      reason: 'Autorisé pour exemple.fr (session)',
      scope: 'site',
      site: 'exemple.fr',
    });
    audit.logPermission('run-1', 'run_command', {
      granted: true,
      scope: 'once',
      requestId: 'req-2',
    });
    audit.logPermission('run-1', 'run_command', { granted: false, reason: 'refusé' });

    const lines = readFileSync(join(dir, 'audit', 'audit-2026-11-21.log'), 'utf8')
      .trim()
      .split('\n')
      .map(l => JSON.parse(l) as Record<string, unknown>);
    expect(lines.map(({ ts: _ts, ...rest }) => rest)).toEqual([
      {
        event: 'PERMISSION',
        runId: 'run-1',
        tool: 'browser_click',
        granted: true,
        scope: 'site',
        site: 'exemple.fr',
        requestId: 'req-1',
        reason: "Autorisé par l'utilisateur",
      },
      // Accord « ce site » réutilisé : sans requestId, c'est sa seule trace.
      {
        event: 'PERMISSION',
        runId: 'run-1',
        tool: 'browser_click',
        granted: true,
        scope: 'site',
        site: 'exemple.fr',
        reason: 'Autorisé pour exemple.fr (session)',
      },
      {
        event: 'PERMISSION',
        runId: 'run-1',
        tool: 'run_command',
        granted: true,
        scope: 'once',
        requestId: 'req-2',
      },
      {
        event: 'PERMISSION',
        runId: 'run-1',
        tool: 'run_command',
        granted: false,
        reason: 'refusé',
      },
    ]);
  });

  it('change de fichier après minuit sans redémarrage', () => {
    let now = new Date('2026-10-07T23:59:59Z');
    const audit = new AuditLogger(() => now);
    audit.startRun('r1', 'c', 'x');
    now = new Date('2026-10-08T00:00:01Z');
    audit.startRun('r2', 'c', 'x');
    expect(readdirSync(join(dir, 'audit')).sort()).toEqual([
      'audit-2026-10-07.log',
      'audit-2026-10-08.log',
    ]);
  });
});
