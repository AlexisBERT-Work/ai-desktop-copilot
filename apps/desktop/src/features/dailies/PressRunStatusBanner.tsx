import { AlertTriangle, CheckCircle2, Loader2, MailWarning } from 'lucide-react';
import { useLocalPressStore } from './localPress';

const PHASE_LABEL: Record<string, string> = {
  collecte: 'collecte des articles',
  redaction: 'rédaction & vérification',
};

interface Props {
  /**
   * Afficher aussi l'état « terminé » (résumé de la dernière génération).
   * Sur la page d'accueil on ne montre que « en cours » et « échec » — un
   * rappel permanent de la dernière génération y serait du bruit.
   */
  showDone?: boolean;
}

/**
 * Statut de la génération des dailys locales, poussé par l'agent
 * (`press:progress`). Un run dure plusieurs minutes : sans ce bandeau,
 * « Générer maintenant » travaille en silence et semble ne rien faire.
 * Affiché dans « Mes journaux » (complet) et sur l'accueil du dashboard.
 */
export function PressRunStatusBanner({ showDone = true }: Props) {
  const status = useLocalPressStore(s => s.status);
  if (status === null) return null;

  const time = (() => {
    const t = new Date(status.at);
    return Number.isNaN(t.getTime())
      ? ''
      : t.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  })();

  if (status.state === 'running') {
    const journal =
      status.journal !== undefined && status.journal.length > 0
        ? ` : « ${status.journal} » (${PHASE_LABEL[status.phase ?? ''] ?? '…'})`
        : '…';
    return (
      <div
        className="flex items-center gap-2 border-b border-brand-400/20 bg-brand-600/10 px-5 py-2
                   text-xs text-brand-200"
        role="status"
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        Génération des dailys en cours — journal {status.current ?? 0}/{status.total ?? 0}
        {journal}
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <div
        className="flex items-center gap-2 border-b border-red-400/20 bg-red-500/10 px-5 py-2
                   text-xs text-red-200"
        role="status"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Génération des dailys échouée{time ? ` à ${time}` : ''} —{' '}
        {status.error ?? 'erreur inconnue'}. Nouvel essai automatique dans les 15 min, ou reclique «
        Générer maintenant ».
      </div>
    );
  }

  // Envoi par e-mail raté : signalé même sur l'accueil — sans ce bandeau,
  // l'utilisateur attend un mail qui ne viendra pas sans savoir pourquoi.
  if (status.emailError !== undefined) {
    return (
      <div
        className="flex items-center gap-2 border-b border-amber-400/20 bg-amber-500/10 px-5 py-2
                   text-xs text-amber-200"
        role="status"
      >
        <MailWarning className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Dailys générées{time ? ` à ${time}` : ''}, mais l'envoi par e-mail a échoué —{' '}
        {status.emailError}
      </div>
    );
  }

  if (!showDone) return null;

  const emailed =
    (status.emailed ?? 0) > 0
      ? ` Envoi par e-mail : ${status.emailed} message${(status.emailed ?? 0) > 1 ? 's' : ''}.`
      : '';

  return (
    <div
      className="flex items-center gap-2 border-b border-white/10 bg-white/5 px-5 py-2 text-xs
                 text-white/60"
      role="status"
    >
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
      {status.produced === 0
        ? `Dernière génération${time ? ` à ${time}` : ''} : rien à publier (aucun article retenu).`
        : `Dernière génération${time ? ` à ${time}` : ''} : ${status.produced ?? 0} daily${(status.produced ?? 0) > 1 ? 's' : ''} produite${(status.produced ?? 0) > 1 ? 's' : ''}.${emailed}`}
    </div>
  );
}
