import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_PRESS_FEED, type PressRunStatus } from '@catdesk/shared-types';
import type { OllamaClient } from '../llm/OllamaClient';
import type { DailyMailer } from './dailyEmail';
import { LocalDailyStore } from './LocalDailyStore';
import { LocalPressFeedStore } from './LocalPressFeedStore';
import { LocalPressScheduler } from './LocalPressScheduler';

const { buildCustomJournalDailies } = vi.hoisted(() => ({ buildCustomJournalDailies: vi.fn() }));
vi.mock('./customJournalDigest', () => ({ buildCustomJournalDailies }));

const llm = {} as OllamaClient;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'catdesk-localpress-'));
  buildCustomJournalDailies.mockResolvedValue([
    { journal: 'Actu IA', category: 'tech', title: 'Actu IA — revue du 16 octobre', body: 'corps' },
  ]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

function setup(emailTo: string | null, mailer: DailyMailer) {
  const feeds = new LocalPressFeedStore(dir);
  feeds.save({ ...EMPTY_PRESS_FEED, name: 'Actu IA', sourceIds: ['actuia'], emailTo });
  const dailies = new LocalDailyStore(dir);
  const statuses: PressRunStatus[] = [];
  const scheduler = new LocalPressScheduler(
    llm,
    'qwen3:14b',
    feeds,
    dailies,
    7,
    undefined,
    s => statuses.push(s),
    mailer,
  );
  return { scheduler, dailies, statuses };
}

describe('LocalPressScheduler — envoi par e-mail', () => {
  it('envoie la daily neuve au destinataire du journal', async () => {
    const mailer = vi.fn<DailyMailer>().mockResolvedValue({ ok: true });
    const { scheduler, statuses } = setup('moi@boulot.fr', mailer);

    expect(await scheduler.runOnce()).toBe(true);
    expect(mailer).toHaveBeenCalledTimes(1);
    expect(mailer.mock.calls[0]?.[0]).toMatchObject({
      to: 'moi@boulot.fr',
      subject: 'Actu IA — revue du 16 octobre',
    });
    expect(statuses.at(-1)).toMatchObject({ state: 'done', produced: 1, emailed: 1 });
  });

  it('ne renvoie rien au run planifié suivant, renvoie sur « Générer maintenant »', async () => {
    const mailer = vi.fn<DailyMailer>().mockResolvedValue({ ok: true });
    const { scheduler } = setup('moi@boulot.fr', mailer);

    await scheduler.runOnce();
    await scheduler.runOnce(); // même titre : rien de neuf (redémarrage, tick suivant)
    expect(mailer).toHaveBeenCalledTimes(1);

    await scheduler.runOnce(true); // régénération manuelle
    expect(mailer).toHaveBeenCalledTimes(2);
  });

  it('un envoi raté ne fait pas échouer le run : dailys gardées, erreur dans le statut', async () => {
    const mailer = vi
      .fn<DailyMailer>()
      .mockResolvedValue({ ok: false, error: 'Identifiants SMTP refusés.' });
    const { scheduler, dailies, statuses } = setup('moi@boulot.fr', mailer);

    expect(await scheduler.runOnce()).toBe(true);
    expect(dailies.list()).toHaveLength(1);
    const last = statuses.at(-1);
    expect(last).toMatchObject({ state: 'done', emailError: 'Identifiants SMTP refusés.' });
    expect(last).not.toHaveProperty('emailed');
  });

  it("sans destinataire, aucun envoi ni erreur d'e-mail", async () => {
    const mailer = vi.fn<DailyMailer>();
    const { scheduler, statuses } = setup(null, mailer);

    await scheduler.runOnce();
    expect(mailer).not.toHaveBeenCalled();
    expect(statuses.at(-1)).not.toHaveProperty('emailError');
  });
});
