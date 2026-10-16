import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';
import {
  describeSmtpError,
  loadSmtpConfig,
  maskEmail,
  pickSmtpKeys,
  readSmtpConfig,
  sendEmail,
  type SmtpConfig,
} from './email';

const GMAIL = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_USER: 'moi@gmail.com',
  SMTP_PASSWORD: 'abcd efgh ijkl mnop',
};

describe('readSmtpConfig', () => {
  it('signale une configuration absente, variables vides comprises', () => {
    const r = readSmtpConfig({ SMTP_HOST: '', SMTP_USER: '  ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non configuré/);
  });

  it('nomme la variable manquante', () => {
    const r = readSmtpConfig({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'moi@gmail.com' });
    expect(r).toEqual({ ok: false, error: 'SMTP_PASSWORD manquant.' });
  });

  it('par défaut : port 465 en TLS direct, expéditeur = compte', () => {
    const r = readSmtpConfig(GMAIL);
    expect(r).toEqual({
      ok: true,
      config: {
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        user: 'moi@gmail.com',
        pass: 'abcd efgh ijkl mnop',
        from: 'moi@gmail.com',
      },
    });
  });

  it('port 587 = STARTTLS, expéditeur surchargeable', () => {
    const r = readSmtpConfig({ ...GMAIL, SMTP_PORT: '587', SMTP_FROM: 'CatDesk <moi@gmail.com>' });
    expect(r.ok && r.config).toMatchObject({
      port: 587,
      secure: false,
      from: 'CatDesk <moi@gmail.com>',
    });
  });

  it('refuse un port invalide', () => {
    expect(readSmtpConfig({ ...GMAIL, SMTP_PORT: 'abc' }).ok).toBe(false);
    expect(readSmtpConfig({ ...GMAIL, SMTP_PORT: '70000' }).ok).toBe(false);
  });
});

describe('pickSmtpKeys', () => {
  it('ne retient que les clés SMTP_* non vides', () => {
    expect(
      pickSmtpKeys({ SMTP_HOST: 'h', SMTP_PORT: '', NODE_OPTIONS: '--require x', PATH: 'p' }),
    ).toEqual({ SMTP_HOST: 'h' });
  });
});

describe('loadSmtpConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'catdesk-smtp-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("préfère l'environnement dès qu'il définit une clé SMTP_*", () => {
    const file = join(dir, 'smtp.env');
    writeFileSync(file, 'SMTP_HOST=autre\nSMTP_USER=a@b.fr\nSMTP_PASSWORD=x\n');
    const r = loadSmtpConfig(GMAIL, file);
    expect(r.ok && r.config.host).toBe('smtp.gmail.com');
  });

  it('sinon lit smtp.env, sans rien prendre hors SMTP_*', () => {
    const file = join(dir, 'smtp.env');
    writeFileSync(
      file,
      '# version installée\nSMTP_HOST=smtp.gmail.com\nSMTP_USER=moi@gmail.com\nSMTP_PASSWORD="abcd efgh"\nCATDESK_TOOL_PROFILE=full\n',
    );
    const env: Record<string, string | undefined> = { PATH: 'p' };
    const r = loadSmtpConfig(env, file);
    expect(r.ok && r.config).toMatchObject({ host: 'smtp.gmail.com', pass: 'abcd efgh' });
    expect(env['CATDESK_TOOL_PROFILE']).toBeUndefined();
  });

  it('un SMTP_PORT seul dans l’environnement ne masque pas smtp.env', () => {
    const file = join(dir, 'smtp.env');
    writeFileSync(file, 'SMTP_HOST=smtp.gmail.com\nSMTP_USER=moi@gmail.com\nSMTP_PASSWORD=x\n');
    const r = loadSmtpConfig({ SMTP_PORT: '465' }, file);
    expect(r.ok && r.config.host).toBe('smtp.gmail.com');
  });

  it('sans env ni fichier : non configuré', () => {
    const r = loadSmtpConfig({}, join(dir, 'absent.env'));
    expect(r.ok).toBe(false);
  });
});

describe('maskEmail', () => {
  it("masque la partie locale d'une adresse", () => {
    expect(maskEmail('alexis@boulot.fr')).toBe('a***@boulot.fr');
    expect(maskEmail('nimportequoi')).toBe('***');
  });
});

describe('describeSmtpError', () => {
  const cfg = { host: 'smtp.gmail.com', port: 465 };
  it("oriente vers le mot de passe d'application sur EAUTH", () => {
    const err = Object.assign(new Error('535 Bad credentials'), { code: 'EAUTH' });
    expect(describeSmtpError(err, cfg)).toMatch(/mot de passe d'application/);
  });
  it('nomme le serveur injoignable', () => {
    const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    expect(describeSmtpError(err, cfg)).toContain('smtp.gmail.com:465');
  });
});

describe('sendEmail', () => {
  const cfg: SmtpConfig = {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    user: 'moi@gmail.com',
    pass: 'secret',
    from: 'moi@gmail.com',
  };
  const msg = { to: 'moi@boulot.fr', subject: 'Actu IA', text: 'texte', html: '<p>html</p>' };

  it('construit le message (transport JSON, sans réseau)', async () => {
    const transport = createTransport({ jsonTransport: true });
    const spy = vi.spyOn(transport, 'sendMail');
    expect(await sendEmail(cfg, msg, transport)).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith({ from: 'moi@gmail.com', ...msg });
  });

  it("renvoie l'erreur au lieu de lever, et ferme le transport", async () => {
    const close = vi.fn();
    const transport = {
      sendMail: vi.fn().mockRejectedValue(Object.assign(new Error('535'), { code: 'EAUTH' })),
      close,
    } as unknown as Transporter;
    const r = await sendEmail(cfg, msg, transport);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Identifiants SMTP refusés/);
      expect(r.error).not.toContain('secret');
    }
    expect(close).toHaveBeenCalled();
  });
});
