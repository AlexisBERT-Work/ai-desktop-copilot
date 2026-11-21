export interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}

/**
 * Interrupteur avec libellé et explication (onglets Voix et Raccourcis).
 * `role="switch"` + `aria-checked` : lisible au lecteur d'écran et dans les tests.
 */
export function Toggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  return (
    <div className="flex items-start gap-4 p-3 rounded-xl border bg-white/3 border-white/8">
      <div className="flex-1">
        <p className="text-sm font-medium text-white/90">{label}</p>
        <p className="text-xs text-white/45 mt-0.5">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 w-10 h-5 rounded-full transition-colors focus:outline-none shrink-0
          disabled:opacity-40 ${checked ? 'bg-brand-500' : 'bg-white/15'}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
            ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </button>
    </div>
  );
}
