// Ce que la veille GitHub quotidienne surveille. Le reste du module ne contient
// aucun choix éditorial : pour changer le périmètre, c'est ici.

export const VEILLE_DOMAINS = [
  'Skills et MCP',
  'Quotidien et bureau',
  'Moteur local',
  'Presse et bourse',
] as const;

export type VeilleDomain = (typeof VEILLE_DOMAINS)[number];

/**
 * Sujets GitHub interrogés, un appel à l'API de recherche chacun. Elle accepte
 * 30 requêtes par minute : rester sous la vingtaine laisse de la marge.
 */
export const DOMAIN_TOPICS: Record<VeilleDomain, readonly string[]> = {
  'Skills et MCP': ['agent-skills', 'claude-skills', 'mcp-server', 'model-context-protocol'],
  'Quotidien et bureau': [
    'computer-use',
    'desktop-automation',
    'browser-automation',
    'personal-assistant',
    'ai-assistant',
  ],
  'Moteur local': [
    'ollama',
    'local-llm',
    'llama-cpp',
    'agent-memory',
    'rag',
    'text-to-speech',
    'speech-to-text',
    'ocr',
  ],
  'Presse et bourse': ['rss', 'news-aggregator', 'web-scraping', 'stock-market'],
};

/**
 * Mots qui rattachent à un domaine un dépôt venu de Trending, qui n'arrive avec
 * aucun sujet interrogé. Un dépôt sans aucun de ces mots est hors périmètre :
 * c'est le filtre qui retire les rails, react et autres grands classiques. Ordre
 * des domaines = priorité. Mots entiers uniquement (`rag` ne doit pas prendre
 * `storage`, ni `tts` prendre `settings`).
 */
export const DOMAIN_KEYWORDS: Record<VeilleDomain, readonly string[]> = {
  'Skills et MCP': ['mcp', 'model context protocol', 'agent skill', 'agent skills', 'skills'],
  'Quotidien et bureau': [
    'computer use',
    'computer-use',
    'desktop automation',
    'browser automation',
    'personal assistant',
    'ai assistant',
    'ai agent',
    'ai agents',
    'agentic',
  ],
  'Moteur local': [
    'ollama',
    'llama.cpp',
    'llm',
    'llms',
    'local ai',
    'rag',
    'embedding',
    'embeddings',
    'tts',
    'stt',
    'text-to-speech',
    'speech-to-text',
    'whisper',
    'ocr',
    'vulkan',
    'quantization',
  ],
  'Presse et bourse': [
    'rss',
    'news aggregator',
    'web scraping',
    'web scraper',
    'stock market',
    'trading',
  ],
};

/** Pages Trending lues : le classement général et les langages de CatDesk. */
export const TRENDING_PAGES: readonly string[] = [
  'https://github.com/trending?since=daily',
  'https://github.com/trending/python?since=daily',
  'https://github.com/trending/typescript?since=daily',
  'https://github.com/trending/rust?since=daily',
];

/**
 * Briques dont une nouvelle version peut changer quelque chose pour CatDesk :
 * celles qu'il utilise, et celles que `AMELIORATIONS.md` prévoit d'adopter.
 */
export const WATCHED_REPOS: readonly string[] = [
  'ollama/ollama',
  'ggml-org/llama.cpp',
  'k2-fsa/sherpa-onnx',
  'tauri-apps/tauri',
  'SYSTRAN/faster-whisper',
  'microsoft/playwright',
  'modelcontextprotocol/typescript-sdk',
  'adbar/trafilatura',
];
