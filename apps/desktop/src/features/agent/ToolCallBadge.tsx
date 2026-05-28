import { Terminal, FileText, Camera, Clipboard, Brain, Globe, Folder } from 'lucide-react';

const TOOL_ICONS: Record<string, React.ReactNode> = {
  run_command: <Terminal className="w-3 h-3" />,
  read_file: <FileText className="w-3 h-3" />,
  write_file: <FileText className="w-3 h-3" />,
  list_directory: <Folder className="w-3 h-3" />,
  capture_screen: <Camera className="w-3 h-3" />,
  ocr_region: <Camera className="w-3 h-3" />,
  read_clipboard: <Clipboard className="w-3 h-3" />,
  write_clipboard: <Clipboard className="w-3 h-3" />,
  search_memory: <Brain className="w-3 h-3" />,
  store_memory: <Brain className="w-3 h-3" />,
};

export function ToolCallBadge({ toolName }: { toolName: string }) {
  const icon = TOOL_ICONS[toolName] ?? <Globe className="w-3 h-3" />;

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                     bg-white/5 border border-white/10 text-white/40 text-xs">
      {icon}
      {toolName}
    </span>
  );
}
