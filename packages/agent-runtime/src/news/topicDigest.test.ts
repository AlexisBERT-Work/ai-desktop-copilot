import { describe, it, expect } from 'vitest';
import {
  buildTopicBody,
  buildTopicPrompt,
  categoryForTopic,
  NEWS_TOPICS,
  parseTopicJson,
  topicTitle,
} from './topicDigest';
import type { NewsItem } from '../tools/web/FetchTechNewsTool';

const ALLOWED = NEWS_TOPICS.map((t) => t.name);

const items: NewsItem[] = [
  { title: 'Sommet UE', url: 'https://a.test/1', source: 'Le Monde', excerpt: 'Discussions tarifaires.' },
  { title: 'Nouvelle puce IA', url: 'https://b.test/2', source: 'CNBC' },
];

describe('topicDigest — fonctions pures', () => {
  it('buildTopicPrompt indexe les articles et liste les sujets autorisés', () => {
    const p = buildTopicPrompt(items, ALLOWED);
    expect(p).toContain('Sujets autorisés : International, Économie & marchés');
    expect(p).toContain('[0] Sommet UE (Le Monde)');
    expect(p).toContain('[1] Nouvelle puce IA (CNBC)');
  });

  it('parseTopicJson ne garde que les sujets autorisés et indices valides', () => {
    const raw = `{"sujets":[
      {"sujet":"International","resume":"Tensions.","articles":[0,9]},
      {"sujet":"Inventé","resume":"x","articles":[1]},
      {"sujet":"Tech & sciences","resume":"","articles":[1]}
    ]}`;
    const groups = parseTopicJson(raw, ALLOWED);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ topic: 'International', summary: 'Tensions.', indices: [0, 9] });
    expect(groups[1]?.topic).toBe('Tech & sciences');
  });

  it('parseTopicJson renvoie [] sur JSON illisible', () => {
    expect(parseTopicJson('pas du json', ALLOWED)).toEqual([]);
  });

  it('categoryForTopic mappe vers la bonne catégorie de daily', () => {
    expect(categoryForTopic('Économie & marchés')).toBe('markets');
    expect(categoryForTopic('Tech & sciences')).toBe('tech');
    expect(categoryForTopic('International')).toBe('misc');
    expect(categoryForTopic('Inconnu')).toBe('misc');
  });

  it('topicTitle est daté et préfixé', () => {
    expect(topicTitle('International', new Date('2026-06-30T08:00:00'))).toMatch(/^Sujet — International · /);
  });

  it('buildTopicBody = résumé + liens avec source', () => {
    const body = buildTopicBody('Résumé du sujet.', items);
    expect(body).toContain('Résumé du sujet.');
    expect(body).toContain('- [Sommet UE](https://a.test/1) _(Le Monde)_');
    expect(body).toContain('- [Nouvelle puce IA](https://b.test/2) _(CNBC)_');
  });
});
