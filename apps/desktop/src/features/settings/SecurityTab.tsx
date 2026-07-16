import { AlertTriangle } from 'lucide-react';
import { DEFAULT_PERMISSION_CONFIG } from '@catdesk/shared-types';
import type { RiskLevel } from '@catdesk/shared-types';
import { useSettingsStore } from './settingsStore';

const RISK_COLORS: Record<RiskLevel, string> = {
  low: 'bg-green-500/15 text-green-400',
  medium: 'bg-yellow-500/15 text-yellow-400',
  high: 'bg-orange-500/15 text-orange-400',
  critical: 'bg-red-500/15 text-red-400',
};

const RISK_DOT: Record<RiskLevel, string> = {
  low: 'bg-green-400',
  medium: 'bg-yellow-400',
  high: 'bg-orange-400',
  critical: 'bg-red-400',
};

/** Onglet Sécurité : mode sans danger + catalogue des outils groupés par risque. */
export function SecurityTab() {
  const { safeMode, setSafeMode } = useSettingsStore();
  const tools = Object.values(DEFAULT_PERMISSION_CONFIG.tools);

  const byRisk: Record<RiskLevel, typeof tools> = {
    low: tools.filter(t => t.riskLevel === 'low'),
    medium: tools.filter(t => t.riskLevel === 'medium'),
    high: tools.filter(t => t.riskLevel === 'high'),
    critical: tools.filter(t => t.riskLevel === 'critical'),
  };

  return (
    <div className="space-y-5">
      {/* Safe mode toggle */}
      <div
        className={`flex items-start gap-4 p-4 rounded-xl border transition-colors
        ${safeMode ? 'bg-orange-500/8 border-orange-500/25' : 'bg-white/3 border-white/8'}`}
      >
        <AlertTriangle
          className={`w-5 h-5 mt-0.5 shrink-0 ${safeMode ? 'text-orange-400' : 'text-white/30'}`}
        />
        <div className="flex-1">
          <p className="text-sm font-medium text-white/90">Mode sans danger</p>
          <p className="text-xs text-white/45 mt-0.5">
            Bloque automatiquement tous les outils à risque moyen, élevé et critique. Seules les
            opérations de lecture restent autorisées.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={safeMode}
          onClick={() => setSafeMode(!safeMode)}
          className={`relative mt-0.5 w-10 h-5 rounded-full transition-colors focus:outline-none shrink-0
            ${safeMode ? 'bg-orange-500' : 'bg-white/15'}`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
              ${safeMode ? 'left-[22px]' : 'left-0.5'}`}
          />
        </button>
      </div>

      {/* Tools table */}
      <div>
        <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
          Catalogue des outils ({tools.length} outils)
        </p>
        <div className="space-y-3">
          {(['low', 'medium', 'high', 'critical'] as RiskLevel[]).map(
            risk =>
              byRisk[risk].length > 0 && (
                <div key={risk}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${RISK_DOT[risk]}`} />
                    <span className="text-xs text-white/35 capitalize">
                      {risk === 'low'
                        ? 'Faible'
                        : risk === 'medium'
                          ? 'Moyen'
                          : risk === 'high'
                            ? 'Élevé'
                            : 'Critique'}{' '}
                      — {byRisk[risk].length} outil{byRisk[risk].length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-0.5 pl-3.5">
                    {byRisk[risk].map(tool => (
                      <div
                        key={tool.name}
                        className={`flex items-center gap-2 py-1.5 px-2.5 rounded-lg
                        ${safeMode && risk !== 'low' ? 'opacity-40' : ''}`}
                      >
                        <code className="text-xs text-white/70 font-mono w-44 shrink-0 truncate">
                          {tool.name}
                        </code>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${RISK_COLORS[risk]}`}
                        >
                          {risk}
                        </span>
                        <span className="text-xs text-white/30 truncate">{tool.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ),
          )}
        </div>
      </div>
    </div>
  );
}
