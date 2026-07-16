// ─── Tool Schemas (JSON Schema definitions for each tool) ──────

// NB : les outils migrés sur zod (lot 1 : filesystem, system, infra) portent
// désormais leur schéma dans leur fichier *Tool.ts (source unique) — leurs
// entrées ont été retirées d'ici.
export const TOOL_SCHEMAS = {
  parse_document: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: {
        type: 'string' as const,
        description:
          'Absolute path to a local .pdf, .docx or .csv file. The format is detected from the extension.',
      },
      max_pages: {
        type: 'number' as const,
        default: 50,
        description: 'PDF only: maximum number of pages to extract',
      },
      max_rows: {
        type: 'number' as const,
        default: 1000,
        description: 'CSV only: maximum number of rows to parse',
      },
    },
  },

  read_calendar: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: {
        type: 'string' as const,
        description: 'Absolute path to a local .ics (iCalendar) file',
      },
      from: {
        type: 'string' as const,
        description: 'Window start as YYYY-MM-DD (defaults to today)',
      },
      to: {
        type: 'string' as const,
        description: 'Window end as YYYY-MM-DD (defaults to from + days)',
      },
      days: {
        type: 'number' as const,
        default: 30,
        description: 'Window length in days when "to" is omitted',
      },
      limit: {
        type: 'number' as const,
        default: 50,
        description: 'Maximum number of events to return',
      },
    },
  },

  export_document: {
    type: 'object' as const,
    required: ['content', 'path'],
    properties: {
      content: {
        type: 'string' as const,
        description: 'Markdown or plain text to render into the document',
      },
      path: {
        type: 'string' as const,
        description: 'Absolute output path. The extension picks the format unless "format" is set.',
      },
      format: {
        type: 'string' as const,
        enum: ['pdf', 'docx', 'html', 'md'] as const,
        description: 'Output format. Optional — inferred from the path extension otherwise.',
      },
      title: {
        type: 'string' as const,
        description: 'Optional document title rendered as a top heading',
      },
    },
  },

  analyze_data: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: {
        type: 'string' as const,
        description: 'Absolute path to a local .csv, .xlsx or .xls file',
      },
      operation: {
        type: 'string' as const,
        enum: ['profile', 'aggregate'] as const,
        default: 'profile',
        description:
          "'profile' = structure + summary stats + preview; 'aggregate' = group_by + an aggregation",
      },
      group_by: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'aggregate only: one or more column names to group by',
      },
      value_column: {
        type: 'string' as const,
        description: "aggregate only: numeric column to aggregate (omit when agg='count')",
      },
      agg: {
        type: 'string' as const,
        enum: ['sum', 'mean', 'median', 'min', 'max', 'count', 'std', 'nunique'] as const,
        default: 'sum',
        description: 'aggregate only: aggregation function',
      },
      sheet: {
        type: 'string' as const,
        description: 'Excel only: sheet name (defaults to the first sheet)',
      },
      max_rows: {
        type: 'number' as const,
        default: 100000,
        description: 'Max rows to load into memory',
      },
    },
  },

  capture_screen: {
    type: 'object' as const,
    properties: {
      region: {
        type: 'object' as const,
        properties: {
          x: { type: 'number' as const },
          y: { type: 'number' as const },
          width: { type: 'number' as const },
          height: { type: 'number' as const },
        },
      },
      activeWindowOnly: { type: 'boolean' as const, default: false },
    },
  },

  ocr_region: {
    type: 'object' as const,
    properties: {
      region: {
        type: 'object' as const,
        properties: {
          x: { type: 'number' as const },
          y: { type: 'number' as const },
          width: { type: 'number' as const },
          height: { type: 'number' as const },
        },
      },
      fullScreen: { type: 'boolean' as const, default: false },
      language: {
        type: 'string' as const,
        default: 'fra+eng',
        description: 'Tesseract language codes',
      },
    },
  },

  describe_screen: {
    type: 'object' as const,
    properties: {
      prompt: {
        type: 'string' as const,
        description: "Question ou consigne sur ce qui est affiché (ex. 'Que montre cet écran ?')",
      },
      region: {
        type: 'object' as const,
        properties: {
          x: { type: 'number' as const },
          y: { type: 'number' as const },
          width: { type: 'number' as const },
          height: { type: 'number' as const },
        },
      },
      activeWindowOnly: { type: 'boolean' as const, default: false },
    },
  },

  read_clipboard: {
    type: 'object' as const,
    properties: {},
  },

  write_clipboard: {
    type: 'object' as const,
    required: ['content'],
    properties: {
      content: { type: 'string' as const, description: 'Content to write to clipboard' },
    },
  },

  store_memory: {
    type: 'object' as const,
    required: ['content'],
    properties: {
      content: { type: 'string' as const, description: 'Information to store in memory' },
      tags: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Tags for retrieval',
      },
    },
  },

  search_memory: {
    type: 'object' as const,
    required: ['query'],
    properties: {
      query: { type: 'string' as const, description: 'Search query' },
      limit: { type: 'number' as const, default: 5, maximum: 20 },
      minScore: { type: 'number' as const, default: 0.6, minimum: 0, maximum: 1 },
    },
  },

  analyze_stacktrace: {
    type: 'object' as const,
    required: ['stacktrace'],
    properties: {
      stacktrace: {
        type: 'string' as const,
        description: 'The stacktrace or error output to analyze',
      },
      context: {
        type: 'string' as const,
        description: 'Optional context about what was happening when the error occurred',
      },
    },
  },

  analyze_logs: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: { type: 'string' as const, description: 'Absolute path to a local log file' },
      max_lines: {
        type: 'number' as const,
        default: 5000,
        maximum: 100000,
        description: 'Analyze only the last N lines',
      },
      pattern: {
        type: 'string' as const,
        description: 'Keep only lines containing this text (case-insensitive) before analyzing',
      },
      top_errors: {
        type: 'number' as const,
        default: 10,
        description: 'Number of grouped error clusters to return',
      },
    },
  },

  generate_unit_tests: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: {
        type: 'string' as const,
        description: 'Absolute path to the source file to generate tests for',
      },
      framework: {
        type: 'string' as const,
        enum: ['auto', 'vitest', 'jest', 'pytest', 'cargo', 'go'] as const,
        default: 'auto',
        description: 'Test framework to target — "auto" detects from the project',
      },
      symbol: {
        type: 'string' as const,
        description: 'Only scaffold tests for this exported function/class (optional)',
      },
    },
  },

  suggest_refactor: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: {
        type: 'string' as const,
        description: 'Absolute path to the source file to analyze for refactoring opportunities',
      },
      max_findings: {
        type: 'number' as const,
        default: 12,
        description: 'Max number of refactoring findings to return',
      },
    },
  },

  analyze_dependencies: {
    type: 'object' as const,
    properties: {
      workdir: {
        type: 'string' as const,
        description:
          'Project root containing package.json / Cargo.toml / requirements.txt (defaults to current directory)',
      },
      manifest: {
        type: 'string' as const,
        description: 'Specific manifest file to analyze (optional, auto-detected otherwise)',
      },
    },
  },

  detect_spiral: {
    type: 'object' as const,
    required: ['events'],
    properties: {
      events: {
        type: 'array' as const,
        description: 'Recent activity events, oldest first',
        items: {
          type: 'object' as const,
          required: ['at', 'signature'],
          properties: {
            at: { type: 'string' as const, description: 'ISO timestamp or epoch ms of the event' },
            kind: {
              type: 'string' as const,
              description: 'Event kind, e.g. "edit", "run", "test_fail", "error" (optional)',
            },
            signature: {
              type: 'string' as const,
              description:
                'What the event is about — same file path, error message, or task. Repetition of this is the spiral signal.',
            },
          },
        },
      },
      threshold_minutes: {
        type: 'number' as const,
        default: 45,
        description: 'Minutes on the same signature before flagging a spiral',
      },
    },
  },

  generate_standup: {
    type: 'object' as const,
    properties: {
      workdir: {
        type: 'string' as const,
        description: 'Git repo root (defaults to current directory)',
      },
      since: {
        type: 'string' as const,
        default: '1 day ago',
        description: 'How far back "yesterday" reaches',
      },
      author: {
        type: 'string' as const,
        description: 'Filter to one author (defaults to the git user)',
      },
      blockers: {
        type: 'string' as const,
        description: 'Free-text blockers to include (optional)',
      },
    },
  },

  load_project_context: {
    type: 'object' as const,
    properties: {
      workdir: {
        type: 'string' as const,
        description: 'Project root to profile (defaults to current directory)',
      },
    },
  },

  analyze_code_style: {
    type: 'object' as const,
    properties: {
      workdir: {
        type: 'string' as const,
        description: 'Directory to sample source files from (defaults to current directory)',
      },
      extensions: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'File extensions to sample, e.g. [".ts", ".py"] (defaults to common code types)',
      },
      max_files: { type: 'number' as const, default: 40, description: 'Max files to sample' },
    },
  },

  semantic_search: {
    type: 'object' as const,
    required: ['query'],
    properties: {
      query: { type: 'string' as const, description: 'What to search for in local files' },
      paths: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Directories to search (defaults to current working directory)',
      },
      extensions: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'File extensions to include, e.g. [".ts", ".md"] (defaults to common text/code types)',
      },
      limit: { type: 'number' as const, default: 10, description: 'Max results to return' },
      max_file_size: {
        type: 'number' as const,
        default: 500000,
        description: 'Skip files larger than this size in bytes',
      },
    },
  },

  obsidian_notes: {
    type: 'object' as const,
    properties: {
      vault: {
        type: 'string' as const,
        description: 'Path to the Obsidian vault folder (falls back to OBSIDIAN_VAULT env var)',
      },
      query: {
        type: 'string' as const,
        description: 'Text to search across note titles and content (optional)',
      },
      note: {
        type: 'string' as const,
        description: 'Read a specific note in full by relative path or title (optional)',
      },
      tag: {
        type: 'string' as const,
        description:
          'Filter to notes carrying this tag (frontmatter or #inline), without the leading #',
      },
      limit: {
        type: 'number' as const,
        default: 15,
        description: 'Max notes to return when searching',
      },
    },
  },

  notion_search: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string' as const,
        description:
          'Text to search across Notion pages and databases (empty returns recently edited)',
      },
      token: {
        type: 'string' as const,
        description: 'Notion integration token (falls back to NOTION_TOKEN env var)',
      },
      page_id: {
        type: 'string' as const,
        description: "Read a specific page's text content instead of searching (optional)",
      },
      filter: {
        type: 'string' as const,
        enum: ['page', 'database', 'all'] as const,
        default: 'all',
        description: 'Restrict results to pages, databases, or both',
      },
      limit: { type: 'number' as const, default: 15, description: 'Max results to return' },
    },
  },

  read_webpage: {
    type: 'object' as const,
    required: ['url'],
    properties: {
      url: { type: 'string' as const, description: 'URL to fetch and extract text from' },
      selector: {
        type: 'string' as const,
        description: 'CSS selector to extract specific element (optional)',
      },
      max_chars: {
        type: 'number' as const,
        default: 20000,
        description: 'Max characters of extracted text to return',
      },
    },
  },

  fetch_tech_news: {
    type: 'object' as const,
    properties: {
      sources: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'Source ids to query (defaults to a balanced mix). Available: hackernews, devto, theverge, arstechnica, techcrunch, hackernoon, numerama, nextinpact, lesnumeriques',
      },
      feeds: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'Custom RSS/Atom feed URLs to include, e.g. ["https://blog.rust-lang.org/feed.xml"]. Added on top of (or instead of) the predefined sources',
      },
      topics: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'Keywords to filter by (matches title or excerpt), e.g. ["AI", "rust", "react"] (optional — no filter if omitted)',
      },
      since_hours: {
        type: 'number' as const,
        default: 24,
        description: 'Only keep articles published within this many hours (0 = no limit)',
      },
      limit: {
        type: 'number' as const,
        default: 15,
        description: 'Max number of articles to return (1-50)',
      },
      lang: {
        type: 'string' as const,
        enum: ['fr', 'en', 'all'] as const,
        default: 'all',
        description: 'Restrict predefined sources to a language (custom feeds are always included)',
      },
    },
  },

  post_tech_news_discord: {
    type: 'object' as const,
    properties: {
      sources: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Source ids (defaults to a balanced mix). Same ids as fetch_tech_news',
      },
      feeds: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description:
          'Custom RSS/Atom feed URLs to include, e.g. ["https://blog.rust-lang.org/feed.xml"]',
      },
      topics: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Keywords to filter by (matches title or excerpt) (optional)',
      },
      since_hours: {
        type: 'number' as const,
        default: 24,
        description: 'Only keep articles published within this many hours (0 = no limit)',
      },
      limit: {
        type: 'number' as const,
        default: 8,
        description: 'Number of articles to post as Discord embeds (1-10)',
      },
      lang: {
        type: 'string' as const,
        enum: ['fr', 'en', 'all'] as const,
        default: 'all',
        description: 'Restrict sources to a language',
      },
      intro: {
        type: 'string' as const,
        description:
          'Short intro line posted above the articles (optional — a default header is used otherwise)',
      },
      webhook_url: {
        type: 'string' as const,
        description: 'Discord incoming webhook URL (falls back to DISCORD_WEBHOOK_URL env var)',
      },
      username: {
        type: 'string' as const,
        description: 'Override the displayed sender name (optional)',
      },
    },
  },

  run_subagent: {
    type: 'object' as const,
    required: ['task'],
    properties: {
      task: {
        type: 'string' as const,
        description: 'Task description for the sub-agent to complete autonomously',
      },
      context: {
        type: 'string' as const,
        description:
          'Curated background the sub-agent needs (relevant facts, file paths, prior findings) — pass exactly what it needs to act, not your whole conversation. The sub-agent starts fresh and only sees this.',
      },
      max_iterations: {
        type: 'number' as const,
        default: 5,
        description: 'Max ReAct iterations for the sub-agent (1-8)',
      },
    },
  },

  run_parallel_agents: {
    type: 'object' as const,
    required: ['tasks'],
    properties: {
      tasks: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Independent task descriptions to execute simultaneously (max 8)',
      },
      max_iterations: {
        type: 'number' as const,
        default: 5,
        description: 'Max ReAct iterations per sub-agent',
      },
    },
  },

  transcribe_audio: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: {
        type: 'string' as const,
        description: 'Absolute path to the audio file (mp3, wav, m4a, mp4, webm, ogg, flac, opus)',
      },
      model: {
        type: 'string' as const,
        enum: ['tiny', 'base', 'small', 'medium', 'large-v3'] as const,
        default: 'base',
        description:
          'Whisper model size — tiny/base: fast; small/medium: accurate; large-v3: best quality',
      },
      language: {
        type: 'string' as const,
        description: 'Language code (e.g. "fr", "en") — auto-detected if omitted',
      },
      task: {
        type: 'string' as const,
        enum: ['transcribe', 'translate'] as const,
        default: 'transcribe',
        description: '"transcribe" keeps original language, "translate" converts to English',
      },
    },
  },

  list_scheduled_tasks: {
    type: 'object' as const,
    properties: {},
  },

  cancel_scheduled_task: {
    type: 'object' as const,
    required: ['id'],
    properties: {
      id: {
        type: 'string' as const,
        description: 'Job ID to cancel — get IDs from list_scheduled_tasks',
      },
    },
  },

  browser_screenshot: {
    type: 'object' as const,
    properties: {
      full_page: {
        type: 'boolean' as const,
        default: false,
        description: 'Capture entire scrollable page (default: visible viewport only)',
      },
      selector: {
        type: 'string' as const,
        description: 'CSS selector of element to screenshot (optional)',
      },
    },
  },

  browser_get_text: {
    type: 'object' as const,
    properties: {
      selector: {
        type: 'string' as const,
        description:
          'CSS selector to extract text from a specific element (optional, defaults to full page)',
      },
      max_chars: {
        type: 'number' as const,
        default: 20000,
        description: 'Max characters to return',
      },
    },
  },

  browser_close: {
    type: 'object' as const,
    properties: {},
  },

  get_market: {
    type: 'object' as const,
    properties: {},
  },

  add_to_watchlist: {
    type: 'object' as const,
    required: ['symbol'],
    properties: {
      symbol: {
        type: 'string' as const,
        description: 'Ticker à suivre, ex. "AAPL", "MSFT", "MC.PA" (Euronext via suffixe Yahoo)',
      },
    },
  },

  remove_from_watchlist: {
    type: 'object' as const,
    required: ['symbol'],
    properties: {
      symbol: { type: 'string' as const, description: 'Ticker à retirer de la watchlist' },
    },
  },

  set_formula: {
    type: 'object' as const,
    required: ['name', 'expression'],
    properties: {
      name: {
        type: 'string' as const,
        description: 'Nom lisible de la formule, ex. "ratio_AAPL_MSFT"',
      },
      expression: {
        type: 'string' as const,
        description:
          'Expression mathjs sur les cotations, ex. "AAPL.price / MSFT.price" ou "max(AAPL.changePercent, MSFT.changePercent)"',
      },
      id: {
        type: 'string' as const,
        description: "Optionnel : id d'une formule existante à modifier",
      },
    },
  },

  remove_formula: {
    type: 'object' as const,
    required: ['id'],
    properties: {
      id: {
        type: 'string' as const,
        description: 'Id de la formule à supprimer (voir get_market)',
      },
    },
  },
} as const;
