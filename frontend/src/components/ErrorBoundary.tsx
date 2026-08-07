import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/**
 * Última línea de defensa: si cualquier vista truena en runtime, se muestra
 * esta pantalla de error con la marca del colegio en lugar de una página en
 * blanco. El 404 tiene su propia página (NotFoundPage); esto cubre el "500"
 * del lado del cliente.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Sentry (si está configurado) ya captura errores globales; esto deja
    // rastro también en consola para desarrollo.
    console.error('ErrorBoundary atrapó un error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-cream-2 px-4 py-16">
        <div className="mx-auto flex max-w-xl flex-col items-center text-center">
          <img
            src="/assets/logo-isotipo.webp"
            alt=""
            width={72}
            height={72}
            className="mb-6 h-[72px] w-[72px]"
          />
          <p className="font-head text-fluid-3xl font-extrabold leading-none text-coral-dark" aria-hidden="true">
            ¡Ups!
          </p>
          <h1 className="mt-4 font-head text-fluid-xl font-bold text-ink">
            Algo salió mal
          </h1>
          <p className="mt-3 text-muted">
            Ocurrió un error inesperado. Recargue la página; si el problema
            persiste, contacte al colegio.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => window.location.reload()} className="btn-pink">
              <RefreshCw size={16} aria-hidden="true" /> Recargar página
            </button>
            <a href="/" className="btn-outline">
              <Home size={16} aria-hidden="true" /> Ir al inicio
            </a>
          </div>
        </div>
      </div>
    );
  }
}
