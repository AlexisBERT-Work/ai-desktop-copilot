import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PRESS_FEED, type Daily, type PressFeed } from '@catdesk/shared-types';
import {
  dailyBodyHtml,
  emailChangedDailies,
  emailSubject,
  groupByRecipient,
  inlineHtml,
  renderDailyEmail,
  type DailyMailer,
} from './dailyEmail';
import { buildJournalBody, type JournalDraft } from './pressDigest';

describe('inlineHtml', () => {
  it('rend les liens http(s) et échappe leur URL', () => {
    expect(inlineHtml('[GPT-6](https://ex.com/a?b=1&c=2) — sorti')).toBe(
      '<a href="https://ex.com/a?b=1&amp;c=2" style="color:#2563eb;font-weight:600;text-decoration:none">GPT-6</a> — sorti',
    );
  });

  it('laisse un lien javascript: en texte', () => {
    const html = inlineHtml('[clic](javascript:alert(1))');
    expect(html).not.toContain('<a ');
    expect(html).toContain('[clic](javascript:alert(1))');
  });

  it('échappe le HTML venu des flux ou du LLM', () => {
    expect(inlineHtml('<script>x</script> & co')).toBe('&lt;script&gt;x&lt;/script&gt; &amp; co');
  });

  it('gras et italique', () => {
    expect(inlineHtml('**fort** et *léger*')).toBe('<strong>fort</strong> et <em>léger</em>');
  });
});

describe('dailyBodyHtml', () => {
  it('rend le corps produit par buildJournalBody : analyse, puces, détail', () => {
    const body = buildJournalBody(
      "L'analyse du jour.",
      [
        { title: 'Article A', url: 'https://a.fr/1', source: 'A' },
        { title: 'Article B', url: 'https://b.fr/2', source: 'B' },
      ],
      ['résumé A', 'résumé B'],
      ['détail A', ''],
    );
    const html = dailyBodyHtml(body);
    expect(html).toMatch(/^<p style="[^"]*">L&#39;analyse du jour\.<\/p>/);
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).toContain('>Article A</a> — résumé A<div');
    expect(html).toContain('>détail A</div></li>');
    expect(html).toContain('>Article B</a> — résumé B</li>');
  });
});

describe('emailSubject', () => {
  it('reprend le titre de la daily seule', () => {
    expect(emailSubject([{ title: 'Actu IA — revue du 16 octobre' }])).toBe(
      'Actu IA — revue du 16 octobre',
    );
  });
  it('résume plusieurs dailys', () => {
    const s = emailSubject([{ title: 'a' }, { title: 'b' }], new Date(2026, 9, 16));
    expect(s).toBe('CatDesk — 2 revues du vendredi 16 octobre');
  });
});

describe('renderDailyEmail', () => {
  it('produit un texte brut et un HTML échappé, avec la mise en garde', () => {
    const m = renderDailyEmail([{ title: 'Actu <IA>', body: '- [x](https://x.fr) — y' }]);
    expect(m.subject).toBe('Actu <IA>');
    expect(m.text).toContain('- [x](https://x.fr) — y');
    expect(m.text).toContain('générés par IA');
    expect(m.html).toContain('Actu &lt;IA&gt;');
    expect(m.html).not.toContain('<IA>');
  });
});

const feed = (name: string, emailTo: string | null): PressFeed => ({
  ...EMPTY_PRESS_FEED,
  id: name,
  name,
  emailTo,
});
const daily = (title: string): Daily => ({
  id: `local-${title}`,
  title,
  body: 'corps',
  category: 'tech',
  publishedAt: '2026-10-16T07:00:00.000Z',
  expiresAt: null,
});
const draft = (journal: string): JournalDraft => ({
  journal,
  category: 'tech',
  title: `${journal} — revue du 16 octobre`,
  body: 'corps',
});

describe('groupByRecipient', () => {
  it('relie chaque daily à son journal et regroupe par destinataire', () => {
    const feeds = [
      feed('Actu IA', 'moi@boulot.fr'),
      feed('Veille LLM', 'moi@boulot.fr'),
      feed('Crypto', null),
    ];
    const drafts = [draft('Actu IA'), draft('Veille LLM'), draft('Crypto')];
    const changed = drafts.map(d => daily(d.title));
    const groups = groupByRecipient(changed, drafts, feeds);
    expect([...groups.keys()]).toEqual(['moi@boulot.fr']);
    expect(groups.get('moi@boulot.fr')?.map(d => d.title)).toEqual([
      'Actu IA — revue du 16 octobre',
      'Veille LLM — revue du 16 octobre',
    ]);
  });

  it("ignore une daily qu'aucun brouillon du run ne relie à un journal", () => {
    const groups = groupByRecipient([daily('inconnue')], [], [feed('Actu IA', 'moi@boulot.fr')]);
    expect(groups.size).toBe(0);
  });
});

describe('emailChangedDailies', () => {
  const drafts = [draft('Actu IA'), draft('Veille LLM')];
  const changed = drafts.map(d => daily(d.title));

  it('un message par destinataire ; un échec ne bloque pas les autres', async () => {
    const mailer = vi
      .fn<DailyMailer>()
      .mockResolvedValueOnce({ ok: false, error: 'SMTP_PASSWORD manquant.' })
      .mockResolvedValueOnce({ ok: true });
    const out = await emailChangedDailies(
      changed,
      drafts,
      [feed('Actu IA', 'a@boulot.fr'), feed('Veille LLM', 'b@boulot.fr')],
      mailer,
    );
    expect(mailer).toHaveBeenCalledTimes(2);
    expect(mailer.mock.calls[1]?.[0]).toMatchObject({
      to: 'b@boulot.fr',
      subject: 'Veille LLM — revue du 16 octobre',
    });
    expect(out).toEqual({ emailed: 1, error: 'SMTP_PASSWORD manquant.' });
  });

  it("n'envoie rien sans destinataire", async () => {
    const mailer = vi.fn<DailyMailer>();
    const out = await emailChangedDailies(changed, drafts, [feed('Actu IA', null)], mailer);
    expect(mailer).not.toHaveBeenCalled();
    expect(out).toEqual({ emailed: 0 });
  });
});

describe('inlineHtml — code', () => {
  it('rend le code entre accents graves', () => {
    expect(inlineHtml('cibler `@chrome`')).toContain('<code style=');
    expect(inlineHtml('cibler `@chrome`')).toContain('>@chrome</code>');
  });
});
