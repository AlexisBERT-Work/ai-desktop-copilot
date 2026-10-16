import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OllamaClient } from '../llm/OllamaClient';
import type { DailyMailer } from './dailyEmail';
import {
  AI_SOURCE_IDS,
  readRecapConfig,
  recapWindowHours,
  runEmailRecap,
  type RecapConfig,
} from './emailRecap';

const { buildCustomJournalDaily } = vi.hoisted(() => ({ buildCustomJournalDaily: vi.fn() }));
vi.mock('./customJournalDigest', () => ({ buildCustomJournalDaily }));

afterEach(() => {
  vi.clearAllMocks();
});

const NOW = new Date('2026-10-17T05:30:00Z');

describe('recapWindowHours', () => {
  it('depuis le dernier envoi, arrondi à l’heure supérieure', () => {
    expect(recapWindowHours('2026-10-16T04:25:00Z', NOW)).toBe(26);
  });

  it('24 h sans date connue (premier run) ou illisible', () => {
    expect(recapWindowHours(undefined, NOW)).toBe(24);
    expect(recapWindowHours('', NOW)).toBe(24);
    expect(recapWindowHours('hier', NOW)).toBe(24);
  });

  it('bornée : 72 h après plusieurs matins ratés, 1 h au minimum', () => {
    expect(recapWindowHours('2026-10-10T05:00:00Z', NOW)).toBe(72);
    expect(recapWindowHours('2026-10-17T06:00:00Z', NOW)).toBe(1);
  });
});

describe('readRecapConfig', () => {
  it('défauts : groupe IA, 12 articles, qwen3:4b, fenêtre depuis RECAP_SINCE', () => {
    const r = readRecapConfig(
      { RECAP_TO: 'moi@boulot.fr', RECAP_SINCE: '2026-10-16T05:30:00Z' },
      NOW,
    );
    expect(r).toEqual({
      ok: true,
      config: {
        to: 'moi@boulot.fr',
        name: 'Actu IA',
        sourceIds: [...AI_SOURCE_IDS],
        articleLimit: 12,
        sinceHours: 24,
        model: 'qwen3:4b',
        dryRun: false,
        out: 'recap-preview.html',
      },
    });
    expect(AI_SOURCE_IDS.length).toBeGreaterThanOrEqual(10);
  });

  it('exige un destinataire valide, sauf en essai à blanc', () => {
    expect(readRecapConfig({}, NOW).ok).toBe(false);
    expect(readRecapConfig({ RECAP_TO: 'moi@boulot' }, NOW).ok).toBe(false);
    const dry = readRecapConfig({ RECAP_DRY_RUN: 'true' }, NOW);
    expect(dry.ok && dry.config.to).toBeNull();
  });

  it('refuse une source inconnue, accepte une liste choisie', () => {
    const bad = readRecapConfig({ RECAP_TO: 'a@b.fr', RECAP_SOURCES: 'actuia,nimporte' }, NOW);
    expect(bad).toEqual({
      ok: false,
      error: 'RECAP_SOURCES : source(s) inconnue(s) — nimporte',
    });
    const good = readRecapConfig({ RECAP_TO: 'a@b.fr', RECAP_SOURCES: 'actuia, openai' }, NOW);
    expect(good.ok && good.config.sourceIds).toEqual(['actuia', 'openai']);
  });

  it('borne le nombre d’articles', () => {
    const r = readRecapConfig({ RECAP_TO: 'a@b.fr', RECAP_LIMIT: '500' }, NOW);
    expect(r.ok && r.config.articleLimit).toBe(40);
  });
});

describe('runEmailRecap', () => {
  const llm = {} as OllamaClient;
  const cfg: RecapConfig = {
    to: 'moi@boulot.fr',
    name: 'Actu IA',
    sourceIds: ['actuia'],
    articleLimit: 12,
    sinceHours: 26,
    model: 'qwen3:4b',
    dryRun: false,
    out: 'x.html',
  };
  const draft = {
    journal: 'Actu IA',
    category: 'tech',
    title: 'Actu IA — revue du 17 octobre',
    body: "L'analyse.\n\n- [A](https://a.fr) — a\n- [B](https://b.fr) — b",
  };

  it('collecte avec la fenêtre demandée et envoie au destinataire', async () => {
    buildCustomJournalDaily.mockResolvedValue(draft);
    const mailer = vi.fn<DailyMailer>().mockResolvedValue({ ok: true });

    const out = await runEmailRecap(cfg, { llm, mailer, now: NOW });

    expect(buildCustomJournalDaily.mock.calls[0]?.[0]).toMatchObject({
      sourceIds: ['actuia'],
      sinceHours: 26,
      articleLimit: 12,
    });
    expect(mailer.mock.calls[0]?.[0]).toMatchObject({
      to: 'moi@boulot.fr',
      subject: 'Actu IA — revue du 17 octobre',
    });
    expect(out).toEqual({ state: 'sent', subject: 'Actu IA — revue du 17 octobre', articles: 2 });
  });

  it('aucun article : rien envoyé, pas une erreur', async () => {
    buildCustomJournalDaily.mockResolvedValue(null);
    const mailer = vi.fn<DailyMailer>();
    expect(await runEmailRecap(cfg, { llm, mailer, now: NOW })).toEqual({ state: 'empty' });
    expect(mailer).not.toHaveBeenCalled();
  });

  it('essai à blanc : renvoie l’aperçu sans envoyer', async () => {
    buildCustomJournalDaily.mockResolvedValue(draft);
    const mailer = vi.fn<DailyMailer>();
    const out = await runEmailRecap({ ...cfg, dryRun: true }, { llm, mailer, now: NOW });
    expect(out.state).toBe('dry-run');
    expect(mailer).not.toHaveBeenCalled();
  });

  it("remonte l'échec d'envoi (le job échoue, la fenêtre suivante rattrape)", async () => {
    buildCustomJournalDaily.mockResolvedValue(draft);
    const mailer = vi.fn<DailyMailer>().mockResolvedValue({ ok: false, error: 'SMTP refusé' });
    expect(await runEmailRecap(cfg, { llm, mailer, now: NOW })).toEqual({
      state: 'error',
      error: 'SMTP refusé',
    });
  });
});
