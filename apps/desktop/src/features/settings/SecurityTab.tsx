import { AlertTriangle, Globe } from 'lucide-react';
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

const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'faible',
  medium: 'moyen',
  high: 'élevé',
  critical: 'critique',
};

/** Interrupteur des réglages de sécurité (même apparence pour chacun). */
function SecuritySwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 w-10 h-5 rounded-full transition-colors focus:outline-none shrink-0
        ${checked ? 'bg-orange-500' : 'bg-white/15'}`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
          ${checked ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  );
}

/** Onglet Sécurité : mode sans danger, navigateur en lecture seule, catalogue des outils par risque. */
export function SecurityTab() {
  const safeMode = useSettingsStore(s => s.safeMode);
  const setSafeMode = useSettingsStore(s => s.setSafeMode);
  const browserReadOnly = useSettingsStore(s => s.browserReadOnly);
  const setBrowserReadOnly = useSettingsStore(s => s.setBrowserReadOnly);
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
        <SecuritySwitch label="Mode sans danger" checked={safeMode} onChange={setSafeMode} />
      </div>

      {/* Navigateur en lecture seule */}
      <div
        className={`flex items-start gap-4 p-4 rounded-xl border transition-colors
        ${browserReadOnly ? 'bg-orange-500/8 border-orange-500/25' : 'bg-white/3 border-white/8'}`}
      >
        <Globe
          className={`w-5 h-5 mt-0.5 shrink-0 ${browserReadOnly ? 'text-orange-400' : 'text-white/30'}`}
        />
        <div className="flex-1">
          <p className="text-sm font-medium text-white/90">Navigateur en lecture seule</p>
          <p className="text-xs text-white/45 mt-0.5">
            Le navigateur de l&apos;agent lit les pages mais n&apos;envoie rien : ni formulaire, ni
            requête d&apos;écriture, ni WebSocket. Ouvrir une page ne demande alors qu&apos;une
            confirmation par session. Coupe-le pour remplir un formulaire en ligne.
          </p>
        </div>
        <SecuritySwitch
          label="Navigateur en lecture seule"
          checked={browserReadOnly}
          onChange={setBrowserReadOnly}
        />
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
                    {byRisk[risk].map(tool => {
                      const lowered =
                        browserReadOnly && tool.riskLevelWhenReadOnly !== undefined
                          ? tool.riskLevelWhenReadOnly
                          : undefined;
                      const effective = lowered ?? risk;
                      return (
                        <div
                          key={tool.name}
                          className={`flex items-center gap-2 py-1.5 px-2.5 rounded-lg
                        ${safeMode && effective !== 'low' ? 'opacity-40' : ''}`}
                        >
                          <code className="text-xs text-white/70 font-mono w-44 shrink-0 truncate">
                            {tool.name}
                          </code>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${RISK_COLORS[risk]}`}
                          >
                            {risk}
                          </span>
                          {lowered !== undefined && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${RISK_COLORS[lowered]}`}
                              title="Risque appliqué tant que le navigateur est en lecture seule"
                            >
                              → {RISK_LABEL[lowered]} en lecture seule
                            </span>
                          )}
                          <span className="text-xs text-white/30 truncate">{tool.description}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ),
          )}
        </div>
      </div>
    </div>
  );
}
