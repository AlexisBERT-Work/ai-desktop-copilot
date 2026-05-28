import type { RiskLevel } from './ipc';

// ─── Permission System ─────────────────────────────────────────

export interface PermissionRequest {
  tool: string;
  args: Record<string, unknown>;
  context?: {
    conversationId?: string;
    activeWindow?: string;
  };
}

export interface PermissionResult {
  granted: boolean;
  reason?: string;
  remember?: boolean;
}

export interface PermissionGrant {
  granted: boolean;
  timestamp: number;
  expiresAt?: number;
}

export interface PermissionConfig {
  safeMode: boolean;
  enabledCritical: string[];
  pathWhitelist: string[];
  tools: Record<string, ToolPermissionConfig>;
}

export interface ToolPermissionConfig {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  enabled: boolean;
  requiresConfirmation: boolean;
}

// ─── Default Permission Config ─────────────────────────────────

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  safeMode: false,
  enabledCritical: [],
  pathWhitelist: [
    // Windows user home directories by default
    '%USERPROFILE%\\Documents',
    '%USERPROFILE%\\Desktop',
    '%USERPROFILE%\\Downloads',
    '%TEMP%',
  ],
  tools: {
    read_file: { name: 'read_file', description: 'Read file content', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    list_directory: { name: 'list_directory', description: 'List directory', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    capture_screen: { name: 'capture_screen', description: 'Capture screen', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    ocr_region: { name: 'ocr_region', description: 'OCR screen region', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    read_clipboard: { name: 'read_clipboard', description: 'Read clipboard', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    search_memory: { name: 'search_memory', description: 'Search memory', riskLevel: 'low', enabled: true, requiresConfirmation: false },
    write_file: { name: 'write_file', description: 'Write file', riskLevel: 'medium', enabled: true, requiresConfirmation: true },
    write_clipboard: { name: 'write_clipboard', description: 'Write clipboard', riskLevel: 'medium', enabled: true, requiresConfirmation: true },
    open_app: { name: 'open_app', description: 'Open application', riskLevel: 'medium', enabled: true, requiresConfirmation: true },
    store_memory: { name: 'store_memory', description: 'Store in memory', riskLevel: 'medium', enabled: true, requiresConfirmation: false },
    run_command: { name: 'run_command', description: 'Run system command', riskLevel: 'high', enabled: true, requiresConfirmation: true },
    close_window: { name: 'close_window', description: 'Close window', riskLevel: 'high', enabled: true, requiresConfirmation: true },
    send_keys: { name: 'send_keys', description: 'Send keyboard input', riskLevel: 'high', enabled: true, requiresConfirmation: true },
    schedule_task: { name: 'schedule_task', description: 'Schedule task', riskLevel: 'high', enabled: true, requiresConfirmation: true },
    delete_file: { name: 'delete_file', description: 'Delete file', riskLevel: 'critical', enabled: false, requiresConfirmation: true },
    run_as_admin: { name: 'run_as_admin', description: 'Elevate privileges', riskLevel: 'critical', enabled: false, requiresConfirmation: true },
  },
};
