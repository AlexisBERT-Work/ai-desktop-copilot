/**
 * BM25 sparse scoring (CATDESK-CONCEPTS-AVANCES §4 — hybrid search).
 * Pure and dependency-free: good at exact keyword / identifier matches, which
 * dense embeddings often miss. Fused with cosine similarity in VectorStore.
 */

export interface Bm25Doc {
  id: string;
  content: string;
}

const K1 = 1.5;
const B = 0.75;

export function tokenize(text: string): string[] {
  return (text ?? '')
    .toLowerCase()
    .split(/[^a-zà-ÿ0-9]+/i)
    .filter(t => t.length > 2);
}

/**
 * BM25 score per document id for a query. Scores are >= 0 (0 = no query term
 * present). Caller normalizes if it needs a [0,1] range.
 */
export function bm25Scores(query: string, docs: Bm25Doc[]): Map<string, number> {
  const scores = new Map<string, number>();
  const queryTerms = [...new Set(tokenize(query))];
  const N = docs.length;
  if (N === 0 || queryTerms.length === 0) return scores;

  const tokenized = docs.map(d => ({ id: d.id, tokens: tokenize(d.content) }));
  const avgdl = tokenized.reduce((s, d) => s + d.tokens.length, 0) / N || 1;

  // Document frequency per query term.
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    df.set(term, tokenized.filter(d => d.tokens.includes(term)).length);
  }

  for (const d of tokenized) {
    const tf = new Map<string, number>();
    for (const tok of d.tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = f + K1 * (1 - B + (B * d.tokens.length) / avgdl);
      score += idf * ((f * (K1 + 1)) / denom);
    }
    if (score > 0) scores.set(d.id, score);
  }
  return scores;
}
