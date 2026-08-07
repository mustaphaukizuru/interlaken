import { Link } from 'react-router-dom';
import { ArrowLeft, Home } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';

/**
 * 404 — replaces the old silent redirect-to-home so users (and crawlers)
 * get honest feedback on a bad URL. Rendered inside PublicLayout.
 */
export default function NotFoundPage() {
  return (
    <section className="bg-cream-2 px-4 py-16 sm:py-24">
      <Seo title="Página no encontrada" description="La página que busca no existe o fue movida." />
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <p className="font-head text-fluid-3xl font-extrabold leading-none text-green" aria-hidden="true">
          404
        </p>
        <h1 className="mt-4 font-head text-fluid-xl font-bold text-ink">
          Página no encontrada
        </h1>
        <p className="mt-3 text-muted">
          La dirección que escribió no existe o fue movida. Verifique el enlace
          o regrese al inicio.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link to="/" className="btn-pink">
            <Home size={16} aria-hidden="true" /> Ir al inicio
          </Link>
          <Link to="/contacto" className="btn-outline">
            <ArrowLeft size={16} aria-hidden="true" /> Contactar al colegio
          </Link>
        </div>
      </div>
    </section>
  );
}
