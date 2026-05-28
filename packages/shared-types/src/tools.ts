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
} as const;
