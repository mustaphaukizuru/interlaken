import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { legalApi } from '@/services/api';
import { Section } from '@/components/ui/Section';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';

interface PrivacyNotice {
  version: string;
  title: string;
  body: string;
  integral_notice_url: string;
  effective_date: string;
}

/**
 * Public Aviso de Privacidad — renders the current notice served by the
 * legal API (apps/legal). Presentation only; the legal text is authored and
 * versioned in the backend, never here.
 */
export default function AvisoPrivacidadPage() {
  const { data, isLoading, isError } = useQuery<PrivacyNotice>({
    queryKey: ['legal-notice'],
    queryFn: async () => {
      const { data } = await legalApi.getNotice();
      return data as PrivacyNotice;
    },
    staleTime: 60 * 60 * 1000,
  });

  return (
    <div>
      <section className="relative overflow-hidden bg-dark text-white">
        <div className="relative mx-auto max-w-[820px] px-6 py-12 sm:py-16">
          <span className="section-label-pink inline-flex">Legal</span>
          <h1 className="mt-3 font-head text-fluid-3xl font-black leading-tight tracking-[-0.02em]">
            {data?.title ?? 'Aviso de Privacidad'}
          </h1>
          {data?.effective_date && (
            <p className="mt-3 flex items-center gap-2 text-sm text-white/60">
              <ShieldCheck size={16} aria-hidden="true" />
              Vigente desde el{' '}
              {(() => {
                try {
                  return format(parseISO(data.effective_date), "d 'de' MMMM 'de' yyyy", { locale: es });
                } catch {
                  return data.effective_date;
                }
              })()}
              {data.version && ` · Versión ${data.version}`}
            </p>
          )}
        </div>
      </section>

      <Section bg="white" containerSize="md">
        {isLoading ? (
          <div className="py-10">
            <LoadingSpinner />
          </div>
        ) : isError || !data?.body ? (
          <EmptyState
            title="Aviso no disponible"
            description="No fue posible cargar el Aviso de Privacidad en este momento. Intente de nuevo más tarde o escríbanos a colegio@interlaken.edu.mx."
          />
        ) : (
          <div className="mx-auto max-w-[760px]">
            <div className="whitespace-pre-line text-[15px] leading-relaxed text-ink/90">
              {data.body}
            </div>
            {data.integral_notice_url && (
              <a
                href={data.integral_notice_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline mt-8 focus-visible:ring-2 focus-visible:ring-purple focus-visible:ring-offset-2"
              >
                Consultar el aviso integral <ExternalLink size={16} />
              </a>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
