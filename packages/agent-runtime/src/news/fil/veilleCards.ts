import type { RepoCandidate, WatchedRelease } from '../veille/collectRepos';
import { EFFORT_LABEL, INTEGRATION_LABEL, pisteRef, repoUrl } from '../veille/renderVeille';
import { type VeilleReport, keepCollected } from '../veille/veilleSchema';
import { type FilCard, type FilCardInput, makeCard, parisDay } from './filCards';

// Veille GitHub → cartes du Fil : une piste devient une carte `github`, une
// nouvelle version une carte `version`. Mêmes pistes, dans le même ordre, que
// le mail et l'archive (keepCollected appliqué ici aussi) : « piste 2 » désigne
// la même chose partout. Pur.

export interface VeilleCardsInput {
  /** Rapport tel que rédigé par Claude, avant keepCollected. */
  report: VeilleReport;
  candidates: readonly RepoCandidate[];
  releases: readonly WatchedRelease[];
  now: Date;
}

export function veilleToCards({ report, candidates, releases, now }: VeilleCardsInput): FilCard[] {
  const kept = keepCollected(
    report,
    new Set(candidates.map(c => c.repo)),
    new Set(releases.map(r => r.repo)),
  );
  const day = parisDay(now);
  const licenses = new Map(candidates.map(c => [c.repo, c.license]));
  const releaseByRepo = new Map(releases.map(r => [r.repo, r]));

  const cards: FilCard[] = [];
  const push = (input: Omit<FilCardInput, 'day' | 'rank'>) =>
    cards.push(makeCard({ ...input, day, rank: cards.length }));

  kept.pistes.forEach((p, i) => {
    push({
      kind: 'github',
      title: p.title,
      summary: p.gain,
      why: p.why,
      verdict: p.verdict,
      details: [
        `${INTEGRATION_LABEL[p.integration]} · ${EFFORT_LABEL[p.effort]} · ${p.domain}`,
        `**Où ça se branche** : ${p.how}`,
        `**Comment le mesurer** : ${p.measure}`,
        `**Risques** : ${p.risks}`,
        `**Licence** : ${p.license}`,
        `Pour en parler : « ${pisteRef(now, i)} ».`,
      ].join('\n\n'),
      url: repoUrl(p.repo),
      source: `${p.repo} · ${licenses.get(p.repo) ?? 'licence inconnue'}`,
    });
  });

  for (const r of kept.releases) {
    const release = releaseByRepo.get(r.repo);
    push({
      kind: 'version',
      title: `${r.repo} ${release?.version ?? r.version}`,
      summary: r.impact,
      // Notes de version : texte d'un tiers, affiché en texte brut par l'app.
      details: release?.notes ?? null,
      url: release?.url ?? repoUrl(r.repo),
      source: r.repo,
    });
  }

  return cards;
}
