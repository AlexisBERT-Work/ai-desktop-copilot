// ─── Tool Schemas (JSON Schema definitions for each tool) ──────

export const TOOL_SCHEMAS = {
  read_file: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: { type: 'string' as const, description: 'Absolute path to the file' },
      encoding: { type: 'string' as const, enum: ['utf-8', 'base64'], default: 'utf-8' },
      maxBytes: { type: 'number' as const, description: 'Max bytes to read', maximum: 1_000_000 },
    },
  },

  list_directory: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: { type: 'string' as const, description: 'Directory path to list' },
      recursive: { type: 'boolean' as const, default: false },
      includeHidden: { type: 'boolean' as const, default: false },
      filter: { type: 'string' as const, description: 'Glob pattern filter' },
    },
  },

  write_file: {
    type: 'object' as const,
    required: ['path', 'content'],
    properties: {
      path: { type: 'string' as const, description: 'Absolute path to write' },
      content: { type: 'string' as const, description: 'Content to write' },
      append: { type: 'boolean' as const, default: false },
      encoding: { type: 'string' as const, enum: ['utf-8', 'base64'], default: 'utf-8' },
    },
  },

  parse_document: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: { type: 'string' as const, description: 'Absolute path to a local .pdf, .docx or .csv file. The format is detected from the extension.' },
      max_pages: { type: 'number' as const, default: 50, description: 'PDF only: maximum number of pages to extract' },
      max_rows: { type: 'number' as const, default: 1000, description: 'CSV only: maximum number of rows to parse' },
    },
  },

  analyze_data: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: { type: 'string' as const, description: 'Absolute path to a local .csv, .xlsx or .xls file' },
      operation: { type: 'string' as const, enum: ['profile', 'aggregate'] as const, default: 'profile', description: "'profile' = structure + summary stats + preview; 'aggregate' = group_by + an aggregation" },
      group_by: { type: 'array' as const, items: { type: 'string' as const }, description: 'aggregate only: one or more column names to group by' },
      value_column: { type: 'string' as const, description: "aggregate only: numeric column to aggregate (omit when agg='count')" },
      agg: { type: 'string' as const, enum: ['sum', 'mean', 'median', 'min', 'max', 'count', 'std', 'nunique'] as const, default: 'sum', description: 'aggregate only: aggregation function' },
      sheet: { type: 'string' as const, description: 'Excel only: sheet name (defaults to the first sheet)' },
      max_rows: { type: 'number' as const, default: 100000, description: 'Max rows to load into memory' },
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
      language: { type: 'string' as const, default: 'fra+eng', description: 'Tesseract language codes' },
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

  docker_ps: {
    type: 'object' as const,
    properties: {
      all: { type: 'boolean' as const, default: false, description: 'Include stopped containers (docker ps -a)' },
      logs_for: { type: 'string' as const, description: 'Also fetch recent logs for this container name/id (optional)' },
      tail: { type: 'number' as const, default: 50, description: 'Number of log lines when logs_for is set' },
    },
  },

  docker_control: {
    type: 'object' as const,
    required: ['action'],
    properties: {
      action: { type: 'string' as const, enum: ['start', 'stop', 'restart', 'up', 'down'] as const, description: 'start/stop/restart a container, or compose up/down a project' },
      target: { type: 'string' as const, description: 'Container name/id (start/stop/restart) or compose file path (up/down, defaults to ./docker-compose.yml)' },
      workdir: { type: 'string' as const, description: 'Working directory for compose commands (defaults to current directory)' },
    },
  },

  run_sqlite: {
    type: 'object' as const,
    required: ['db_path', 'query'],
    properties: {
      db_path: { type: 'string' as const, description: 'Path to the SQLite database file' },
      query: { type: 'string' as const, description: 'SQL to execute' },
      read_only: { type: 'boolean' as const, default: true, description: 'Reject anything but SELECT/PRAGMA/EXPLAIN when true' },
    },
  },

  audit_env: {
    type: 'object' as const,
    properties: {
      workdir: { type: 'string' as const, description: 'Project root containing the env files (defaults to current directory)' },
      env_file: { type: 'string' as const, default: '.env', description: 'Env file to audit, relative to workdir' },
      example_file: { type: 'string' as const, default: '.env.example', description: 'Template file to compare against, relative to workdir' },
    },
  },

  inspect_port: {
    type: 'object' as const,
    properties: {
      port: { type: 'number' as const, description: 'TCP port to inspect (optional — lists all listening ports if omitted)' },
    },
  },

  kill_process: {
    type: 'object' as const,
    required: ['pid'],
    properties: {
      pid: { type: 'number' as const, description: 'Process ID to terminate' },
      force: { type: 'boolean' as const, default: false, description: 'Force kill (taskkill /F) instead of a graceful stop' },
    },
  },

  run_command: {
    type: 'object' as const,
    required: ['command'],
    properties: {
      command: { type: 'string' as const, description: 'The command to execute' },
      shell: { type: 'string' as const, enum: ['powershell', 'cmd'], default: 'powershell' },
      workdir: { type: 'string' as const, description: 'Working directory' },
      timeoutMs: { type: 'number' as const, default: 30000, maximum: 120000 },
    },
  },

  open_app: {
    type: 'object' as const,
    required: ['name'],
    properties: {
      name: { type: 'string' as const, description: 'Application name or executable path' },
      args: { type: 'string' as const, description: 'Command line arguments' },
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
      tags: { type: 'array' as const, items: { type: 'string' as const }, description: 'Tags for retrieval' },
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
      stacktrace: { type: 'string' as const, description: 'The stacktrace or error output to analyze' },
      context: { type: 'string' as const, description: 'Optional context about what was happening when the error occurred' },
    },
  },

  generate_commit_message: {
    type: 'object' as const,
    properties: {
      workdir: { type: 'string' as const, description: 'Git repo root (defaults to current directory)' },
      staged_only: { type: 'boolean' as const, default: true, description: 'Use only staged diff (true) or full working tree diff (false)' },
    },
  },

  generate_pr_description: {
    type: 'object' as const,
    properties: {
      workdir: { type: 'string' as const, description: 'Git repo root (defaults to current directory)' },
      base_branch: { type: 'string' as const, default: 'main', description: 'Base branch to compare against' },
    },
  },

  generate_unit_tests: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: { type: 'string' as const, description: 'Absolute path to the source file to generate tests for' },
      framework: { type: 'string' as const, enum: ['auto', 'vitest', 'jest', 'pytest', 'cargo', 'go'] as const, default: 'auto', description: 'Test framework to target — "auto" detects from the project' },
      symbol: { type: 'string' as const, description: 'Only scaffold tests for this exported function/class (optional)' },
    },
  },

  suggest_refactor: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: { type: 'string' as const, description: 'Absolute path to the source file to analyze for refactoring opportunities' },
      max_findings: { type: 'number' as const, default: 12, description: 'Max number of refactoring findings to return' },
    },
  },

  review_diff: {
    type: 'object' as const,
    properties: {
      workdir: { type: 'string' as const, description: 'Git repo root (defaults to current directory)' },
      base_branch: { type: 'string' as const, description: 'Review committed changes vs this branch (e.g. "main"). If omitted, reviews uncommitted working-tree changes' },
      staged_only: { type: 'boolean' as const, default: false, description: 'When reviewing the working tree, look only at staged changes' },
    },
  },

  analyze_dependencies: {
    type: 'object' as const,
    properties: {
      workdir: { type: 'string' as const, description: 'Project root containing package.json / Cargo.toml / requirements.txt (defaults to current directory)' },
      manifest: { type: 'string' as const, description: 'Specific manifest file to analyze (optional, auto-detected otherwise)' },
    },
  },

  watch_ci: {
    type: 'object' as const,
    required: ['repo'],
    properties: {
      repo: { type: 'string' as const, description: 'GitHub repo in "owner/name" format (e.g. "alexis/catdesk")' },
      branch: { type: 'string' as const, description: 'Branch to watch (defaults to current git branch)' },
      token: { type: 'string' as const, description: 'GitHub personal access token (falls back to GITHUB_TOKEN env var)' },
      limit: { type: 'number' as const, default: 5, description: 'Number of recent workflow runs to fetch' },
    },
  },

  bisect_guided: {
    type: 'object' as const,
    required: ['good'],
    properties: {
      workdir: { type: 'string' as const, description: 'Git repo root (defaults to current directory)' },
      good: { type: 'string' as const, description: 'Last known-good commit/ref (where the bug is absent)' },
      bad: { type: 'string' as const, default: 'HEAD', description: 'Known-bad commit/ref (where the bug is present)' },
      path: { type: 'string' as const, description: 'Limit the suspect range to commits touching this file/dir (optional)' },
      test_command: { type: 'string' as const, description: 'Command that exits 0 when good, non-zero when bad — enables a `git bisect run` one-liner (optional)' },
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
            kind: { type: 'string' as const, description: 'Event kind, e.g. "edit", "run", "test_fail", "error" (optional)' },
            signature: { type: 'string' as const, description: 'What the event is about — same file path, error message, or task. Repetition of this is the spiral signal.' },
          },
        },
      },
      threshold_minutes: { type: 'number' as const, default: 45, description: 'Minutes on the same signature before flagging a spiral' },
    },
  },

  generate_standup: {
    type: 'object' as const,
    properties: {
      workdir: { type: 'string' as const, description: 'Git repo root (defaults to current directory)' },
      since: { type: 'string' as const, default: '1 day ago', description: 'How far back "yesterday" reaches' },
      author: { type: 'string' as const, description: 'Filter to one author (defaults to the git user)' },
      blockers: { type: 'string' as const, description: 'Free-text blockers to include (optional)' },
    },
  },

  summarize_git_log: {
    type: 'object' as const,
    properties: {
      workdir: { type: 'string' as const, description: 'Git repo root (defaults to current directory)' },
      since: { type: 'string' as const, description: 'Time window, e.g. "1 week ago", "2024-01-01" (optional)' },
      path: { type: 'string' as const, description: 'Limit to commits touching this file or directory (optional)' },
      author: { type: 'string' as const, description: 'Filter by author name/email substring (optional)' },
      max: { type: 'number' as const, default: 100, description: 'Max commits to analyze' },
    },
  },

  resolve_conflicts: {
    type: 'object' as const,
    properties: {
      workdir: { type: 'string' as const, description: 'Git repo root (defaults to current directory)' },
      path: { type: 'string' as const, description: 'Analyze only this conflicted file (optional, defaults to all)' },
    },
  },

  load_project_context: {
    type: 'object' as const,
    properties: {
      workdir: { type: 'string' as const, description: 'Project root to profile (defaults to current directory)' },
    },
  },

  analyze_code_style: {
    type: 'object' as const,
    properties: {
      workdir: { type: 'string' as const, description: 'Directory to sample source files from (defaults to current directory)' },
      extensions: { type: 'array' as const, items: { type: 'string' as const }, description: 'File extensions to sample, e.g. [".ts", ".py"] (defaults to common code types)' },
      max_files: { type: 'number' as const, default: 40, description: 'Max files to sample' },
    },
  },

  semantic_search: {
    type: 'object' as const,
    required: ['query'],
    properties: {
      query: { type: 'string' as const, description: 'What to search for in local files' },
      paths: { type: 'array' as const, items: { type: 'string' as const }, description: 'Directories to search (defaults to current working directory)' },
      extensions: { type: 'array' as const, items: { type: 'string' as const }, description: 'File extensions to include, e.g. [".ts", ".md"] (defaults to common text/code types)' },
      limit: { type: 'number' as const, default: 10, description: 'Max results to return' },
      max_file_size: { type: 'number' as const, default: 500000, description: 'Skip files larger than this size in bytes' },
    },
  },

  obsidian_notes: {
    type: 'object' as const,
    properties: {
      vault: { type: 'string' as const, description: 'Path to the Obsidian vault folder (falls back to OBSIDIAN_VAULT env var)' },
      query: { type: 'string' as const, description: 'Text to search across note titles and content (optional)' },
      note: { type: 'string' as const, description: 'Read a specific note in full by relative path or title (optional)' },
      tag: { type: 'string' as const, description: 'Filter to notes carrying this tag (frontmatter or #inline), without the leading #' },
      limit: { type: 'number' as const, default: 15, description: 'Max notes to return when searching' },
    },
  },

  call_api: {
    type: 'object' as const,
    required: ['url'],
    properties: {
      url: { type: 'string' as const, description: 'Full URL. https:// anywhere, or http:// only for localhost/127.0.0.1 (local MCP/API servers)' },
      method: { type: 'string' as const, enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const, default: 'GET', description: 'HTTP method' },
      headers: { type: 'object' as const, description: 'Extra request headers as a string→string map (optional)' },
      body: { type: 'string' as const, description: 'Request body for POST/PUT/PATCH. JSON string unless a Content-Type header says otherwise (optional)' },
      token: { type: 'string' as const, description: 'Bearer token added as Authorization header (optional)' },
      timeout_ms: { type: 'number' as const, default: 15000, maximum: 60000, description: 'Request timeout' },
    },
  },

  send_webhook_message: {
    type: 'object' as const,
    required: ['message'],
    properties: {
      message: { type: 'string' as const, description: 'Message text to post to the channel' },
      platform: { type: 'string' as const, enum: ['discord', 'slack'] as const, default: 'discord', description: 'Which incoming-webhook format to use' },
      webhook_url: { type: 'string' as const, description: 'Incoming webhook URL (falls back to DISCORD_WEBHOOK_URL / SLACK_WEBHOOK_URL by platform)' },
      username: { type: 'string' as const, description: 'Override the displayed sender name (Discord only)' },
    },
  },

  notion_search: {
    type: 'object' as const,
    properties: {
      query: { type: 'string' as const, description: 'Text to search across Notion pages and databases (empty returns recently edited)' },
      token: { type: 'string' as const, description: 'Notion integration token (falls back to NOTION_TOKEN env var)' },
      page_id: { type: 'string' as const, description: 'Read a specific page\'s text content instead of searching (optional)' },
      filter: { type: 'string' as const, enum: ['page', 'database', 'all'] as const, default: 'all', description: 'Restrict results to pages, databases, or both' },
      limit: { type: 'number' as const, default: 15, description: 'Max results to return' },
    },
  },

  read_webpage: {
    type: 'object' as const,
    required: ['url'],
    properties: {
      url: { type: 'string' as const, description: 'URL to fetch and extract text from' },
      selector: { type: 'string' as const, description: 'CSS selector to extract specific element (optional)' },
      max_chars: { type: 'number' as const, default: 20000, description: 'Max characters of extracted text to return' },
    },
  },

  fetch_tech_news: {
    type: 'object' as const,
    properties: {
      sources: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Source ids to query (defaults to a balanced mix). Available: hackernews, devto, theverge, arstechnica, techcrunch, hackernoon, numerama, nextinpact, lesnumeriques',
      },
      feeds: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Custom RSS/Atom feed URLs to include, e.g. ["https://blog.rust-lang.org/feed.xml"]. Added on top of (or instead of) the predefined sources',
      },
      topics: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Keywords to filter by (matches title or excerpt), e.g. ["AI", "rust", "react"] (optional — no filter if omitted)',
      },
      since_hours: { type: 'number' as const, default: 24, description: 'Only keep articles published within this many hours (0 = no limit)' },
      limit: { type: 'number' as const, default: 15, description: 'Max number of articles to return (1-50)' },
      lang: { type: 'string' as const, enum: ['fr', 'en', 'all'] as const, default: 'all', description: 'Restrict predefined sources to a language (custom feeds are always included)' },
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
        description: 'Custom RSS/Atom feed URLs to include, e.g. ["https://blog.rust-lang.org/feed.xml"]',
      },
      topics: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Keywords to filter by (matches title or excerpt) (optional)',
      },
      since_hours: { type: 'number' as const, default: 24, description: 'Only keep articles published within this many hours (0 = no limit)' },
      limit: { type: 'number' as const, default: 8, description: 'Number of articles to post as Discord embeds (1-10)' },
      lang: { type: 'string' as const, enum: ['fr', 'en', 'all'] as const, default: 'all', description: 'Restrict sources to a language' },
      intro: { type: 'string' as const, description: 'Short intro line posted above the articles (optional — a default header is used otherwise)' },
      webhook_url: { type: 'string' as const, description: 'Discord incoming webhook URL (falls back to DISCORD_WEBHOOK_URL env var)' },
      username: { type: 'string' as const, description: 'Override the displayed sender name (optional)' },
    },
  },

  github_list_issues: {
    type: 'object' as const,
    required: ['repo'],
    properties: {
      repo: { type: 'string' as const, description: 'GitHub repo in "owner/name" format' },
      token: { type: 'string' as const, description: 'GitHub PAT (falls back to GITHUB_TOKEN env var)' },
      state: { type: 'string' as const, enum: ['open', 'closed', 'all'] as const, default: 'open', description: 'Issue state filter' },
      labels: { type: 'string' as const, description: 'Comma-separated labels to filter by' },
      search: { type: 'string' as const, description: 'Text search query (searches title and body)' },
      limit: { type: 'number' as const, default: 20, description: 'Max number of issues to return' },
    },
  },

  run_subagent: {
    type: 'object' as const,
    required: ['task'],
    properties: {
      task: { type: 'string' as const, description: 'Task description for the sub-agent to complete autonomously' },
      context: { type: 'string' as const, description: 'Curated background the sub-agent needs (relevant facts, file paths, prior findings) — pass exactly what it needs to act, not your whole conversation. The sub-agent starts fresh and only sees this.' },
      max_iterations: { type: 'number' as const, default: 5, description: 'Max ReAct iterations for the sub-agent (1-8)' },
    },
  },

  run_parallel_agents: {
    type: 'object' as const,
    required: ['tasks'],
    properties: {
      tasks: { type: 'array' as const, items: { type: 'string' as const }, description: 'Independent task descriptions to execute simultaneously (max 8)' },
      max_iterations: { type: 'number' as const, default: 5, description: 'Max ReAct iterations per sub-agent' },
    },
  },

  transcribe_audio: {
    type: 'object' as const,
    required: ['path'],
    properties: {
      path: { type: 'string' as const, description: 'Absolute path to the audio file (mp3, wav, m4a, mp4, webm, ogg, flac, opus)' },
      model: { type: 'string' as const, enum: ['tiny', 'base', 'small', 'medium', 'large-v3'] as const, default: 'base', description: 'Whisper model size — tiny/base: fast; small/medium: accurate; large-v3: best quality' },
      language: { type: 'string' as const, description: 'Language code (e.g. "fr", "en") — auto-detected if omitted' },
      task: { type: 'string' as const, enum: ['transcribe', 'translate'] as const, default: 'transcribe', description: '"transcribe" keeps original language, "translate" converts to English' },
    },
  },

  github_get_pr: {
    type: 'object' as const,
    required: ['repo', 'pr_number'],
    properties: {
      repo: { type: 'string' as const, description: 'GitHub repo in "owner/name" format' },
      pr_number: { type: 'number' as const, description: 'Pull request number' },
      token: { type: 'string' as const, description: 'GitHub PAT (falls back to GITHUB_TOKEN env var)' },
      include_diff: { type: 'boolean' as const, default: false, description: 'Include the full unified diff (can be large)' },
      include_comments: { type: 'boolean' as const, default: true, description: 'Include review comments and PR comments' },
    },
  },

  schedule_task: {
    type: 'object' as const,
    required: ['task', 'schedule'],
    properties: {
      task: { type: 'string' as const, description: 'Agent task description to run on a recurring schedule (natural language)' },
      schedule: { type: 'string' as const, description: 'When to run: "every 5m", "every 30m", "every 1h", "every 6h", "every 1d", "hourly", "daily", "weekly"' },
      name: { type: 'string' as const, description: 'Human-readable label for this job (optional, defaults to truncated task)' },
      enabled: { type: 'boolean' as const, default: true, description: 'Whether the job starts active (default: true)' },
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
      id: { type: 'string' as const, description: 'Job ID to cancel — get IDs from list_scheduled_tasks' },
    },
  },

  browser_navigate: {
    type: 'object' as const,
    required: ['url'],
    properties: {
      url: { type: 'string' as const, description: 'URL to navigate to (must start with http:// or https://)' },
      wait_until: { type: 'string' as const, enum: ['load', 'domcontentloaded', 'networkidle'] as const, default: 'domcontentloaded', description: 'When to consider navigation complete' },
      timeout_ms: { type: 'number' as const, default: 30000, description: 'Navigation timeout in milliseconds' },
    },
  },

  browser_screenshot: {
    type: 'object' as const,
    properties: {
      full_page: { type: 'boolean' as const, default: false, description: 'Capture entire scrollable page (default: visible viewport only)' },
      selector: { type: 'string' as const, description: 'CSS selector of element to screenshot (optional)' },
    },
  },

  browser_get_text: {
    type: 'object' as const,
    properties: {
      selector: { type: 'string' as const, description: 'CSS selector to extract text from a specific element (optional, defaults to full page)' },
      max_chars: { type: 'number' as const, default: 20000, description: 'Max characters to return' },
    },
  },

  browser_click: {
    type: 'object' as const,
    required: ['selector'],
    properties: {
      selector: { type: 'string' as const, description: 'CSS selector or text="…" locator of the element to click' },
      timeout_ms: { type: 'number' as const, default: 10000, description: 'Max time to wait for element to be clickable' },
    },
  },

  browser_type: {
    type: 'object' as const,
    required: ['selector', 'text'],
    properties: {
      selector: { type: 'string' as const, description: 'CSS selector of the input/textarea to fill' },
      text: { type: 'string' as const, description: 'Text to type into the element' },
      clear_first: { type: 'boolean' as const, default: true, description: 'Clear existing content before typing' },
      timeout_ms: { type: 'number' as const, default: 10000, description: 'Max time to wait for element' },
    },
  },

  browser_close: {
    type: 'object' as const,
    properties: {},
  },
} as const;
