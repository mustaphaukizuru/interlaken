import { Link } from 'react-router-dom';
import { ArrowRight, GraduationCap, Info, LockKeyhole } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';

/**
 * Comunidad → Plataformas: accesos digitales de la comunidad escolar.
 * Las ligas de las plataformas académicas del ciclo (editoriales, inglés,
 * etc.) las publica el colegio aquí cuando arranca el ciclo — se agregan
 * en cuanto la dirección las confirme.
 */
export default function PlataformasPage() {
  return (
    <div>
      <Seo
        title="Plataformas"
        description="Accesos digitales de la comunidad Interlaken: Portal de Familias (pagos, cafetería, avisos) y plataformas académicas del ciclo escolar."
      />

      <section className="bg-dark text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <span className="section-label-purple inline-flex">Comunidad</span>
          <h1 className="mt-3 font-head text-fluid-3xl font-black tracking-[-0.02em]">
            Plataformas
          </h1>
          <p className="mt-3 max-w-2xl text-[15.5px] text-white/80">
            Los accesos digitales que la comunidad Interlaken utiliza durante el
            ciclo escolar, en un solo lugar.
          </p>
        </div>
      </section>

      <section className="bg-white py-12 sm:py-16">
        <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-6">
          <div className="rounded-xl2 border border-green/30 bg-green/5 p-6">
            <p className="flex items-center gap-2 font-head text-lg font-bold text-ink">
              <GraduationCap size={20} className="text-green-dark" aria-hidden="true" />
              Portal de Familias Interlaken
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Consulte el saldo de cafetería de sus hijos, realice recargas y
              pagos de colegiaturas, reciba avisos y comunicados, y agende
              visitas — todo con su cuenta del colegio.
            </p>
            <Link to="/login" className="btn-pink mt-4">
              <LockKeyhole size={15} aria-hidden="true" /> Entrar al Portal
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>

          <div className="rounded-xl2 border border-ink/10 bg-cream-2 p-6">
            <p className="flex items-center gap-2 font-head text-lg font-bold text-ink">
              <Info size={18} className="text-purple" aria-hidden="true" />
              Plataformas académicas del ciclo
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Las ligas de acceso a las plataformas educativas del ciclo escolar
              vigente (materiales digitales, inglés y evaluaciones) se entregan a
              cada familia al inicio del ciclo y se publican en esta página.
              Si necesita recuperar un acceso, escríbanos por WhatsApp o al
              correo de su nivel — vea{' '}
              <Link to="/contacto" className="font-medium text-green-dark underline">
                Contacto
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
