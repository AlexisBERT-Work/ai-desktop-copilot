// Transport e-mail sortant (SMTP) : configuration, envoi, erreurs lisibles.
// Volontairement ignorant du domaine presse — la mise en forme des dailys vit
// dans news/dailyEmail.ts.

import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createTransport, type Transporter } from 'nodemailer';
import { dataPath } from './dataDir';

type EnvLike = Record<string, string | undefined>;

export interface SmtpConfig {
  host: string;
  port: number;
  /** TLS implicite (port 465) ; sinon STARTTLS, exigé (jamais d'identifiants en clair). */
  secure: boolean;
  user: string;
  pass: string;
  /** Expéditeur affiché ; par défaut le compte SMTP. */
  from: string;
}

export type SmtpConfigResult = { ok: true; config: SmtpConfig } | { ok: false; error: string };

/** Fichier lu par la version installée, dont le `.env` est en lecture seule (Program Files). */
export const SMTP_ENV_FILE = 'smtp.env';

const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] as const;

/** Ne garde que les clés SMTP_* (un fichier de config ne doit rien régler d'autre). Pur. */
export function pickSmtpKeys(env: EnvLike): EnvLike {
  const out: EnvLike = {};
  for (const key of SMTP_KEYS) {
    const v = env[key]?.trim();
    if (v !== undefined && v.length > 0) out[key] = v;
  }
  return out;
}

/** Configuration SMTP depuis un environnement (variable vide = absente). Pur. */
export function readSmtpConfig(env: EnvLike): SmtpConfigResult {
  const e = pickSmtpKeys(env);
  const host = e['SMTP_HOST'];
  const user = e['SMTP_USER'];
  const pass = e['SMTP_PASSWORD'];
  if (host === undefined && user === undefined && pass === undefined) {
    return {
      ok: false,
      error:
        "Envoi par e-mail non configuré : renseigne SMTP_HOST, SMTP_USER et SMTP_PASSWORD (voir .env.example de l'agent).",
    };
  }
  if (host === undefined) return { ok: false, error: 'SMTP_HOST manquant.' };
  if (user === undefined) return { ok: false, error: 'SMTP_USER manquant.' };
  if (pass === undefined) return { ok: false, error: 'SMTP_PASSWORD manquant.' };

  const rawPort = e['SMTP_PORT'];
  const port = rawPort === undefined ? 465 : Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { ok: false, error: `SMTP_PORT invalide : ${rawPort ?? ''}` };
  }
  return {
    ok: true,
    config: { host, port, secure: port === 465, user, pass, from: e['SMTP_FROM'] ?? user },
  };
}

/**
 * Configuration SMTP du poste : l'environnement (`.env` de l'agent, en dev)
 * s'il nomme un serveur ou un compte, sinon le fichier `smtp.env` du dossier
 * de données (version installée), dont seules les clés SMTP_* sont retenues.
 * Un `SMTP_PORT` seul (recopié de `.env.example`) ne masque pas `smtp.env`.
 */
export function loadSmtpConfig(
  env: EnvLike = process.env,
  file: string = dataPath(SMTP_ENV_FILE),
): SmtpConfigResult {
  const e = pickSmtpKeys(env);
  if (e['SMTP_HOST'] ?? e['SMTP_USER'] ?? e['SMTP_PASSWORD']) return readSmtpConfig(env);
  let fromFile: EnvLike = {};
  try {
    fromFile = parseEnv(readFileSync(file, 'utf-8'));
  } catch {
    /* pas de fichier : « non configuré » ci-dessous */
  }
  return readSmtpConfig(fromFile);
}

/** `alexis@exemple.fr` → `a***@exemple.fr` : une adresse ne va pas en clair dans les logs. Pur. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${address[0] ?? ''}***${address.slice(at)}`;
}

/**
 * Message d'erreur SMTP en français, avec la piste la plus probable. Les codes
 * viennent de nodemailer (`err.code`) ; jamais d'identifiant dans le texte. Pur.
 */
export function describeSmtpError(err: unknown, cfg: Pick<SmtpConfig, 'host' | 'port'>): string {
  const code =
    err !== null && typeof err === 'object' && 'code' in err ? String(err.code) : undefined;
  const raw = err instanceof Error ? err.message : String(err);
  switch (code) {
    case 'EAUTH':
      return "Identifiants SMTP refusés (Gmail : il faut un mot de passe d'application, pas le mot de passe du compte).";
    case 'ECONNECTION':
    case 'ETIMEDOUT':
    case 'ESOCKET':
    case 'EDNS':
      return `Serveur SMTP injoignable (${cfg.host}:${cfg.port}) — ${raw}`;
    case 'ETLS':
      return `Échec TLS avec ${cfg.host}:${cfg.port} (465 = TLS direct, 587 = STARTTLS) — ${raw}`;
    case 'EENVELOPE':
      return `Adresse refusée par le serveur SMTP — ${raw}`;
    default:
      return `Envoi SMTP échoué — ${raw}`;
  }
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendEmailResult = { ok: true } | { ok: false; error: string };

function smtpTransport(cfg: SmtpConfig): Transporter {
  return createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

/**
 * Envoie un e-mail. Ne lève jamais : renvoie l'erreur, en français.
 * `transport` n'est fourni que par les tests (jsonTransport, sans réseau).
 */
export async function sendEmail(
  cfg: SmtpConfig,
  msg: EmailMessage,
  transport: Transporter = smtpTransport(cfg),
): Promise<SendEmailResult> {
  try {
    await transport.sendMail({
      from: cfg.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeSmtpError(err, cfg) };
  } finally {
    transport.close();
  }
}

/**
 * Envoie avec la configuration SMTP du poste, relue à chaque envoi : corriger
 * `smtp.env` prend effet au run suivant, sans redémarrer CatDesk. Non
 * configuré ⇒ erreur explicite (remontée dans le statut du run).
 */
export async function sendConfiguredEmail(msg: EmailMessage): Promise<SendEmailResult> {
  const smtp = loadSmtpConfig();
  if (!smtp.ok) return smtp;
  return sendEmail(smtp.config, msg);
}
