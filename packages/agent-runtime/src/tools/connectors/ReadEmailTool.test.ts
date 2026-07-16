import { describe, it, expect } from 'vitest';
import { resolveImapConfig, buildSearchCriteria, ReadEmailTool } from './ReadEmailTool';

describe('resolveImapConfig', () => {
  it('utilise les args en priorité', () => {
    const r = resolveImapConfig(
      { host: 'imap.example.com', user: 'u', password: 'p', port: 1993, secure: false },
      {},
    );
    expect(r).toEqual({
      ok: true,
      config: {
        host: 'imap.example.com',
        port: 1993,
        secure: false,
        user: 'u',
        pass: 'p',
        mailbox: 'INBOX',
      },
    });
  });

  it("retombe sur les variables d'environnement", () => {
    const r = resolveImapConfig({}, { IMAP_HOST: 'h', IMAP_USER: 'u', IMAP_PASSWORD: 'p' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.port).toBe(993);
      expect(r.config.secure).toBe(true);
    }
  });

  it('secure=false par défaut sur le port 143', () => {
    const r = resolveImapConfig({ host: 'h', user: 'u', password: 'p', port: 143 }, {});
    expect(r.ok && r.config.secure).toBe(false);
  });

  it('échoue clairement si host/user/password manquent', () => {
    expect(resolveImapConfig({ user: 'u', password: 'p' }, {}).ok).toBe(false);
    expect(resolveImapConfig({ host: 'h', password: 'p' }, {}).ok).toBe(false);
    expect(resolveImapConfig({ host: 'h', user: 'u' }, {}).ok).toBe(false);
  });
});

describe('buildSearchCriteria', () => {
  it('renvoie null sans filtre (mode récent)', () => {
    expect(buildSearchCriteria({})).toBeNull();
  });

  it('mappe unseen_only / since / search', () => {
    const c = buildSearchCriteria({ unseen_only: true, since: '2026-01-01', search: 'facture' });
    expect(c).not.toBeNull();
    expect(c?.['seen']).toBe(false);
    expect(c?.['since']).toBeInstanceOf(Date);
    expect(c?.['or']).toEqual([{ subject: 'facture' }, { from: 'facture' }]);
  });

  it('ignore une date invalide', () => {
    expect(buildSearchCriteria({ since: 'pas-une-date' })).toBeNull();
  });
});

describe('ReadEmailTool', () => {
  const tool = new ReadEmailTool();

  it('connecteur sortant : high + confirmation', () => {
    expect(tool.riskLevel).toBe('high');
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('échoue proprement sans configuration', async () => {
    const r = await tool.run({});
    expect(r.success).toBe(false);
    expect(r.error).toContain('host');
  });
});
