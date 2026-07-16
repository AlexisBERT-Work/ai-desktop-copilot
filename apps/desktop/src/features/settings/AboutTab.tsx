import { Cat } from 'lucide-react';

/** Onglet À propos : identité de l'app et stack technique. */
export function AboutTab() {
  const stack = [
    { label: 'Shell', value: 'Tauri 2 + Rust' },
    { label: 'Frontend', value: 'React 19 + TypeScript' },
    { label: 'Agent', value: 'Node.js sidecar' },
    { label: 'LLM', value: 'Ollama (local)' },
    { label: 'OCR', value: 'Tesseract + Python' },
    { label: 'Navigateur', value: 'Playwright headless' },
    { label: 'Mémoire', value: 'SQLite + vecteurs locaux' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div
          className="w-12 h-12 rounded-2xl bg-brand-500/20 border border-brand-500/30
                        flex items-center justify-center"
        >
          <Cat className="h-6 w-6 text-brand-300" aria-hidden />
        </div>
        <div>
          <h3 className="text-base font-semibold text-white/90">CatDesk</h3>
          <p className="text-xs text-white/40 mt-0.5">
            Version 0.1.0 — Local-first AI Desktop Copilot
          </p>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
          Stack technique
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {stack.map(({ label, value }) => (
            <div key={label} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/3">
              <span className="text-xs text-white/40 w-20 shrink-0">{label}</span>
              <span className="text-xs text-white/70">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-1 border-t border-white/5">
        <p className="text-xs text-white/25">
          MIT © 2026 CatDesk Contributors · 100% local, 0% cloud
        </p>
      </div>
    </div>
  );
}
