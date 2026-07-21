import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OllamaClient } from '../llm/OllamaClient';
import type { JournalDraft } from './pressDigest';
import {
  dayKey,
  isRunDue,
  PressDigestScheduler,
  type PressDigestConfig,
} from './PressDigestScheduler';

const { buildPressDailies, buildTopicDigest, buildCustomJournalDailies, fetchEnabledPressFeeds } =
  vi.hoisted(() => ({
    buildPressDailies: vi.fn(),
    buildTopicDigest: vi.fn(),
    buildCustomJournalDailies: vi.fn(),
    fetchEnabledPressFeeds: vi.fn(),
  }));
const { publishDailies, publishDailiesOpen, hasTodaysSharedDigest } = vi.hoisted(() => ({
  publishDailies: vi.fn(),
  publishDailiesOpen: vi.fn(),
  hasTodaysSharedDigest: vi.fn(),
}));
const { publishDailiesToDiscord } = vi.hoisted(() => ({ publishDailiesToDiscord: vi.fn() }));

vi.mock('./pressDigest', async importOriginal => ({
  ...(await importOriginal<typeof import('./pressDigest')>()),
  buildPressDailies,
}));
vi.mock('./topicDigest', () => ({ buildTopicDigest }));
vi.mock('./customJournalDigest', () => ({ buildCustomJournalDailies }));
vi.mock('./PressFeedStore', () => ({ fetchEnabledPressFeeds }));
vi.mock('./SupabasePublisher', () => ({
  publishDailies,
  publishDailiesOpen,
  hasTodaysSharedDigest,
}));
vi.mock('./DiscordDailyPublisher', () => ({ publishDailiesToDiscord }));

const llm = {} as OllamaClient;

function draft(title: string): JournalDraft {
  return { journal: title, category: 'misc', title, body: 'corps' };
}

function baseConfig(over: Partial<PressDigestConfig> = {}): PressDigestConfig {
  return {
    sourceIds: ['lemonde'],
    topics: [],
    sinceHours: 24,
    perJournalLimit: 10,
    mode: 'both',
    topicLimit: 40,
    synthesis: true,
    hour: 7,
    runOnStart: false,
    supabase: { url: 'https://proj.supabase.co', anonKey: 'anon' },
    ...over,
  };
}

function emptyPublish() {
  return { published: 0, skipped: 0, errors: [], publishedDrafts: [] };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('dayKey / isRunDue', () => {
  it('formate la clé de jour', () => {
    expect(dayKey(new Date(2026, 6, 20))).toBe('2026-7-20');
  });

  it("dû seulement après l'heure et si pas déjà fait aujourd'hui", () => {
    const now = new Date(2026, 6, 20, 8, 0);
    expect(isRunDue(7, null, now)).toBe(true);
    expect(isRunDue(7, dayKey(now), now)).toBe(false);
    expect(isRunDue(9, null, now)).toBe(false);
  });
});

describe('PressDigestScheduler.runOnce', () => {
  it('lot déjà publié par un autre poste : ne génère rien, renvoie vrai', async () => {
    hasTodaysSharedDigest.mockResolvedValue(true);
    const scheduler = new PressDigestScheduler(llm, 'test-model', baseConfig());

    const ok = await scheduler.runOnce();

    expect(ok).toBe(true);
    expect(buildPressDailies).not.toHaveBeenCalled();
    expect(buildTopicDigest).not.toHaveBeenCalled();
    expect(publishDailiesOpen).not.toHaveBeenCalled();
  });

  it('mode both : fusionne journaux + sujets puis publie en ouvert (sans admin)', async () => {
    hasTodaysSharedDigest.mockResolvedValue(false);
    buildPressDailies.mockResolvedValue([draft('Le Monde — revue du 20 juillet')]);
    buildTopicDigest.mockResolvedValue([draft('Sujet — Tech & sciences · 20 juillet')]);
    publishDailiesOpen.mockResolvedValue(emptyPublish());
    const cfg = baseConfig();
    const scheduler = new PressDigestScheduler(llm, 'test-model', cfg);

    const ok = await scheduler.runOnce();

    expect(ok).toBe(true);
    expect(buildPressDailies).toHaveBeenCalledTimes(1);
    expect(buildTopicDigest).toHaveBeenCalledTimes(1);
    expect(publishDailiesOpen).toHaveBeenCalledWith(
      cfg.supabase,
      expect.arrayContaining([
        expect.objectContaining({ title: 'Le Monde — revue du 20 juillet' }),
        expect.objectContaining({ title: 'Sujet — Tech & sciences · 20 juillet' }),
      ]),
    );
    // Sans identifiants admin : aucun extra ne se déclenche.
    expect(fetchEnabledPressFeeds).not.toHaveBeenCalled();
    expect(publishDailiesToDiscord).not.toHaveBeenCalled();
  });

  it("mode 'journal' seul : ne construit pas le digest par sujet", async () => {
    hasTodaysSharedDigest.mockResolvedValue(false);
    buildPressDailies.mockResolvedValue([draft('Le Monde — revue du 20 juillet')]);
    publishDailiesOpen.mockResolvedValue(emptyPublish());
    const scheduler = new PressDigestScheduler(llm, 'test-model', baseConfig({ mode: 'journal' }));

    await scheduler.runOnce();

    expect(buildPressDailies).toHaveBeenCalledTimes(1);
    expect(buildTopicDigest).not.toHaveBeenCalled();
  });

  it('avec identifiants admin : publie aussi les journaux personnalisés', async () => {
    hasTodaysSharedDigest.mockResolvedValue(false);
    buildPressDailies.mockResolvedValue([]);
    buildTopicDigest.mockResolvedValue([]);
    publishDailiesOpen.mockResolvedValue(emptyPublish());
    fetchEnabledPressFeeds.mockResolvedValue([{ id: 'f1', name: 'Le monde IA' }]);
    buildCustomJournalDailies.mockResolvedValue([draft('Le monde IA — revue du 20 juillet')]);
    publishDailies.mockResolvedValue({
      published: 1,
      skipped: 0,
      errors: [],
      publishedDrafts: [draft('Le monde IA — revue du 20 juillet')],
    });
    const admin = {
      url: 'https://proj.supabase.co',
      anonKey: 'anon',
      email: 'a@b.c',
      password: 'x',
    };
    const scheduler = new PressDigestScheduler(llm, 'test-model', baseConfig({ admin }));

    const ok = await scheduler.runOnce();

    expect(ok).toBe(true);
    expect(fetchEnabledPressFeeds).toHaveBeenCalledWith(admin);
    expect(buildCustomJournalDailies).toHaveBeenCalledTimes(1);
    expect(publishDailies).toHaveBeenCalledWith(admin, expect.any(Array));
  });

  it('admin sans journal personnalisé actif : ne tente pas buildCustomJournalDailies', async () => {
    hasTodaysSharedDigest.mockResolvedValue(false);
    buildPressDailies.mockResolvedValue([]);
    buildTopicDigest.mockResolvedValue([]);
    publishDailiesOpen.mockResolvedValue(emptyPublish());
    fetchEnabledPressFeeds.mockResolvedValue([]);
    const admin = {
      url: 'https://proj.supabase.co',
      anonKey: 'anon',
      email: 'a@b.c',
      password: 'x',
    };
    const scheduler = new PressDigestScheduler(llm, 'test-model', baseConfig({ admin }));

    await scheduler.runOnce();

    expect(buildCustomJournalDailies).not.toHaveBeenCalled();
    expect(publishDailies).not.toHaveBeenCalled();
  });

  it('admin + webhook + dailys neuves : miroite sur Discord', async () => {
    hasTodaysSharedDigest.mockResolvedValue(false);
    buildPressDailies.mockResolvedValue([]);
    buildTopicDigest.mockResolvedValue([]);
    const published = [draft('Le Monde — revue du 20 juillet')];
    publishDailiesOpen.mockResolvedValue({
      published: 1,
      skipped: 0,
      errors: [],
      publishedDrafts: published,
    });
    fetchEnabledPressFeeds.mockResolvedValue([]);
    publishDailiesToDiscord.mockResolvedValue({ posted: 1, batches: 1, errors: [] });
    const admin = {
      url: 'https://proj.supabase.co',
      anonKey: 'anon',
      email: 'a@b.c',
      password: 'x',
    };
    const scheduler = new PressDigestScheduler(
      llm,
      'test-model',
      baseConfig({ admin, discordWebhook: 'https://discord/webhook' }),
    );

    await scheduler.runOnce();

    expect(publishDailiesToDiscord).toHaveBeenCalledWith('https://discord/webhook', published);
  });

  it('rien de neuf à publier : pas de miroir Discord même si admin + webhook configurés', async () => {
    hasTodaysSharedDigest.mockResolvedValue(false);
    buildPressDailies.mockResolvedValue([]);
    buildTopicDigest.mockResolvedValue([]);
    publishDailiesOpen.mockResolvedValue(emptyPublish());
    fetchEnabledPressFeeds.mockResolvedValue([]);
    const admin = {
      url: 'https://proj.supabase.co',
      anonKey: 'anon',
      email: 'a@b.c',
      password: 'x',
    };
    const scheduler = new PressDigestScheduler(
      llm,
      'test-model',
      baseConfig({ admin, discordWebhook: 'https://discord/webhook' }),
    );

    await scheduler.runOnce();

    expect(publishDailiesToDiscord).not.toHaveBeenCalled();
  });

  it('un run concurrent renvoie faux immédiatement (garde running)', async () => {
    hasTodaysSharedDigest.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(false), 20)),
    );
    buildPressDailies.mockResolvedValue([]);
    buildTopicDigest.mockResolvedValue([]);
    publishDailiesOpen.mockResolvedValue(emptyPublish());
    const scheduler = new PressDigestScheduler(llm, 'test-model', baseConfig());

    const first = scheduler.runOnce();
    const second = await scheduler.runOnce();
    expect(second).toBe(false);
    await first;
  });

  it('erreur en cours de run : loggée, renvoie faux, libère le verrou pour le run suivant', async () => {
    hasTodaysSharedDigest.mockResolvedValue(false);
    buildPressDailies.mockRejectedValueOnce(new Error('source injoignable'));
    const scheduler = new PressDigestScheduler(llm, 'test-model', baseConfig());

    expect(await scheduler.runOnce()).toBe(false);

    // Le verrou est bien libéré : un run suivant peut repartir normalement.
    buildPressDailies.mockResolvedValue([]);
    buildTopicDigest.mockResolvedValue([]);
    publishDailiesOpen.mockResolvedValue(emptyPublish());
    expect(await scheduler.runOnce()).toBe(true);
  });
});
