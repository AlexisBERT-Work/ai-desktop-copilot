import { describe, it, expect } from 'vitest';
import { notionTitle, blockToText, resolveNotionToken } from './notionApi';

describe('notionTitle', () => {
  it('lit le titre d\'une base (title array)', () => {
    expect(notionTitle({ title: [{ plain_text: 'My ' }, { plain_text: 'DB' }] })).toBe('My DB');
  });

  it('lit le titre d\'une page (properties.*.title)', () => {
    const page = {
      properties: {
        Name: { type: 'title', title: [{ plain_text: 'Page Title' }] },
        Status: { type: 'select' },
      },
    };
    expect(notionTitle(page)).toBe('Page Title');
  });

  it('retourne un fallback sans titre', () => {
    expect(notionTitle({ properties: {} })).toBe('(sans titre)');
  });
});

describe('blockToText', () => {
  it('aplati le rich_text selon le type', () => {
    const block = { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Hello ' }, { plain_text: 'world' }] } };
    expect(blockToText(block)).toBe('Hello world');
  });

  it('retourne vide pour un bloc sans texte', () => {
    expect(blockToText({ type: 'divider', divider: {} })).toBe('');
  });
});

describe('resolveNotionToken', () => {
  it('préfère l\'argument', () => {
    expect(resolveNotionToken('arg-token')).toBe('arg-token');
  });
});
