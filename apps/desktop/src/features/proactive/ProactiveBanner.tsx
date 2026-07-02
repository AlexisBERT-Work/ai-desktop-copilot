import { Lightbulb } from 'lucide-react';
import { useProactiveStore } from './proactiveStore';

/**
 * A gentle, dismissable nudge surfaced when the agent detects the user is
 * looping on the same problem. Non-blocking: bottom-center, easy to dismiss.
 */
export function ProactiveBanner() {
  const { current, dismiss } = useProactiveStore();
  if (current === null) return null;

  const title =
    current.kind === 'spiral' ? 'Tu sembles bloqué sur le même point' : 'Suggestion';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-amber-300/40 bg-amber-50/95 px-4 py-3 shadow-lg backdrop-blur dark:border-amber-400/30 dark:bg-amber-950/90">
        <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
        <div className="flex-1 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-100">{title}</p>
          {current.suggestion !== null && (
            <p className="mt-1 text-amber-800/90 dark:text-amber-200/80">{current.suggestion}</p>
          )}
          {typeof current.minutesOnTopic === 'number' && (
            <p className="mt-1 text-xs text-amber-700/70 dark:text-amber-300/60">
              ~{current.minutesOnTopic} min sur le même sujet
              {typeof current.failureCount === 'number' && current.failureCount > 0
                ? ` · ${current.failureCount} échec(s)`
                : ''}
            </p>
          )}
        </div>
        <button
          onClick={dismiss}
          className="ml-1 rounded-md px-2 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-200/60 dark:text-amber-300 dark:hover:bg-amber-800/40"
          aria-label="Ignorer"
        >
          OK
        </button>
      </div>
    </div>
  );
}
