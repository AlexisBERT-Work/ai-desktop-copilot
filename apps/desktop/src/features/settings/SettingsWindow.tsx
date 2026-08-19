import { useState } from 'react';
import { X, Cpu, Shield, Keyboard, Info, Palette } from 'lucide-react';
import { useOverlayStore } from '../overlay/overlayStore';
import { AppearancePanel } from '../appearance/AppearancePanel';
import { ModelTab } from './ModelTab';
import { SecurityTab } from './SecurityTab';
import { HotkeysTab } from './HotkeysTab';
import { AboutTab } from './AboutTab';

type SettingsTab = 'appearance' | 'model' | 'security' | 'hotkeys' | 'about';

/** Fenêtre Paramètres : coquille (header + navigation) ; chaque onglet a son fichier. */
export function SettingsWindow() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('model');
  const { setMode } = useOverlayStore();

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
    { id: 'appearance', label: 'Apparence', icon: <Palette className="w-4 h-4" /> },
    { id: 'model', label: 'Modèle', icon: <Cpu className="w-4 h-4" /> },
    { id: 'security', label: 'Sécurité', icon: <Shield className="w-4 h-4" /> },
    { id: 'hotkeys', label: 'Raccourcis', icon: <Keyboard className="w-4 h-4" /> },
    { id: 'about', label: 'À propos', icon: <Info className="w-4 h-4" /> },
  ];

  return (
    <div
      className="w-[720px] h-[540px] rounded-2xl border border-white/10 bg-gray-950/97
                    shadow-2xl shadow-black/60 backdrop-blur-2xl overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5 shrink-0">
        <h2 className="text-sm font-semibold text-white/90">Paramètres</h2>
        <button
          onClick={() => setMode('chat')}
          className="p-1 rounded-lg hover:bg-white/8 transition-colors"
          aria-label="Fermer"
        >
          <X className="w-4 h-4 text-white/40 hover:text-white/70 transition-colors" />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-40 border-r border-white/5 py-2 flex flex-col gap-0.5 px-2 shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors
                ${
                  activeTab === tab.id
                    ? 'bg-brand-500/15 text-brand-400'
                    : 'text-white/50 hover:text-white/70 hover:bg-white/5'
                }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'appearance' && <AppearancePanel />}
          {activeTab === 'model' && <ModelTab />}
          {activeTab === 'security' && <SecurityTab />}
          {activeTab === 'hotkeys' && <HotkeysTab />}
          {activeTab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}
