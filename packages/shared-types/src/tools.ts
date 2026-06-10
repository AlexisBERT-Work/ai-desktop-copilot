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

  watch_ci: {
    type: 'object' as const,
    required: ['repo'],
    properties: {
      repo: { type: 'string' as const, description: 'GitHub repo in "owner/name" format (e.g. "alexis/neurodesk")' },
      branch: { type: 'string' as const, description: 'Branch to watch (defaults to current git branch)' },
      token: { type: 'string' as const, description: 'GitHub personal access token (falls back to GITHUB_TOKEN env var)' },
      limit: { type: 'number' as const, default: 5, description: 'Number of recent workflow runs to fetch' },
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

  read_webpage: {
    type: 'object' as const,
    required: ['url'],
    properties: {
      url: { type: 'string' as const, description: 'URL to fetch and extract text from' },
      selector: { type: 'string' as const, description: 'CSS selector to extract specific element (optional)' },
      max_chars: { type: 'number' as const, default: 20000, description: 'Max characters of extracted text to return' },
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
