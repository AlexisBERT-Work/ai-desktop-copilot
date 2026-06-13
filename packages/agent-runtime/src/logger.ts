export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(namespace: string): Logger {
  const log = (level: string, msg: string, meta?: Record<string, unknown>) => {
    const entry = {
      ts: new Date().toISOString(),
      level,
      ns: namespace,
      msg,
      ...meta,
    };
    // Write to stderr to keep stdout clean for JSON-RPC
    process.stderr.write(JSON.stringify(entry) + '\n');
  };

  return {
    info: (msg, meta) => log('INFO', msg, meta),
    warn: (msg, meta) => log('WARN', msg, meta),
    error: (msg, meta) => log('ERROR', msg, meta),
    debug: (msg, meta) => {
      if (process.env['CATDESK_DEBUG']) log('DEBUG', msg, meta);
    },
  };
}
