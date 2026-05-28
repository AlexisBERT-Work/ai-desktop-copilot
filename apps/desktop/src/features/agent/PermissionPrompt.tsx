import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, ShieldCheck, ShieldX, Terminal, FileText, Camera } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { PermissionRequestEvent } from '@neurodesk/shared-types';

const RISK_CONFIG = {
  low:      { color: 'text-green-400',  bg: 'bg-green-400/10',  border: 'border-green-400/20',  Icon: ShieldCheck },
  medium:   { color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/20', Icon: ShieldAlert },
  high:     { color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/20', Icon: ShieldAlert },
  critical: { color: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-400/20',    Icon: ShieldX },
} as const;

export function PermissionPrompt() {
  const [request, setRequest] = useState<PermissionRequestEvent | null>(null);

  useEffect(() => {
    const unlisten = listen<PermissionRequestEvent>('permission:request', e => {
      setRequest(e.payload);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const respond = async (granted: boolean, remember = false) => {
    if (!request) return;
    await invoke('permission_respond', {
      requestId: request.requestId,
      granted,
      remember,
    });
    setRequest(null);
  };

  return (
    <AnimatePresence>
      {request && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Dialog */}
          <motion.div
            className="fixed inset-0 flex items-center justify-center z-50 p-6"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <div className="w-full max-w-md rounded-2xl border border-white/10
                            bg-gray-950/98 shadow-2xl overflow-hidden">

              {/* Risk header */}
              <PermissionHeader riskLevel={request.riskLevel} tool={request.tool} />

              {/* Body */}
              <div className="px-5 py-4 space-y-3">
                <p className="text-sm text-white/70">{request.description}</p>

                {/* Args preview */}
                {Object.keys(request.args).length > 0 && (
                  <div className="rounded-xl bg-white/5 border border-white/8 p-3">
                    <p className="text-xs text-white/40 mb-2 font-mono">Paramètres</p>
                    <pre className="text-xs text-white/70 font-mono overflow-x-auto selectable">
                      {JSON.stringify(request.args, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="px-5 pb-5 flex flex-col gap-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => respond(false)}
                    className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm
                               text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    Refuser
                  </button>
                  <button
                    onClick={() => respond(true)}
                    className="flex-1 py-2.5 rounded-xl bg-brand-600 text-sm
                               text-white hover:bg-brand-500 transition-colors font-medium"
                  >
                    Autoriser
                  </button>
                </div>
                {(request.riskLevel === 'medium') && (
                  <button
                    onClick={() => respond(true, true)}
                    className="w-full py-2 text-xs text-white/30 hover:text-white/60 transition-colors"
                  >
                    Autoriser pour cette session
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function PermissionHeader({ riskLevel, tool }: { riskLevel: string; tool: string }) {
  const cfg = RISK_CONFIG[riskLevel as keyof typeof RISK_CONFIG] ?? RISK_CONFIG.high;
  const { Icon, color, bg, border } = cfg;

  const RISK_LABELS = {
    low: 'Risque faible',
    medium: 'Risque modéré',
    high: 'Risque élevé',
    critical: 'Action critique',
  } as const;

  return (
    <div className={`flex items-center gap-3 px-5 py-4 border-b border-white/5 ${bg}`}>
      <div className={`p-2 rounded-xl ${bg} ${border} border`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">
          Autorisation requise — <span className="font-mono">{tool}</span>
        </p>
        <p className={`text-xs ${color}`}>
          {RISK_LABELS[riskLevel as keyof typeof RISK_LABELS] ?? riskLevel}
        </p>
      </div>
    </div>
  );
}
