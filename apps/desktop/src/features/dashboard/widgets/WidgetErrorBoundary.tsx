import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Isole le plantage d'un widget : un widget qui throw n'emporte pas tout le
 * tableau de bord (exigence « erreur isolée par widget » de la doc plateforme).
 */
export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[dashboard] widget crashed:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="flex h-full min-h-[60px] items-center justify-center rounded-lg
                     border border-red-500/30 bg-red-500/5 px-2 text-center text-xs text-red-300/80"
          role="alert"
        >
          Ce widget a rencontré une erreur.
        </div>
      );
    }
    return this.props.children;
  }
}
