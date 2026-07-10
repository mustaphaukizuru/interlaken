import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  BellRing, Building2, ChevronDown, ExternalLink, FileText, Mail, Phone,
  Printer, Share2, ShieldCheck, SlidersHorizontal, Target, Undo2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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

interface NoticeSection {
  title: string;
  paragraphs: string[];
}

/**
 * Divide el texto oficial en secciones legibles usando sus propios
 * encabezados (párrafos en mayúsculas). El texto legal NO se altera —
 * solo se presenta por secciones; si la estructura no se reconoce,
 * se muestra íntegro tal cual (fallback).
 */
export function parseNotice(body: string): { intro: string[]; sections: NoticeSection[] } {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const isHeading = (p: string) => {
    const letters = p.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
    if (letters.length < 15) return false;
    const upper = letters.replace(/[a-záéíóúüñ]/g, '');
    return upper.length / letters.length > 0.9;
  };

  const intro: string[] = [];
  const sections: NoticeSection[] = [];
  for (const p of paragraphs) {
    if (isHeading(p)) {
      sections.push({ title: p.replace(/\s*\n\s*/g, ' '), paragraphs: [] });
    } else if (sections.length === 0) {
      intro.push(p);
    } else {
      sections[sections.length - 1].paragraphs.push(p);
    }
  }
  return { intro, sections };
}

function sectionIcon(title: string): LucideIcon {
  const t = title.toUpperCase();
  if (t.includes('FINES')) return Target;
  if (t.includes('QUÉ DATOS')) return FileText;
  if (t.includes('COMPARTIMOS')) return Share2;
  if (t.includes('ACCEDER')) return ShieldCheck;
  if (t.includes('REVOCAR')) return Undo2;
  if (t.includes('LIMITAR')) return SlidersHorizontal;
  if (t.includes('CAMBIOS')) return BellRing;
  return FileText;
}

export default function AvisoPrivacidadPage() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, isError } = useQuery<PrivacyNotice>({
    queryKey: ['legal-notice'],
    queryFn: async () => {
      const { data } = await legalApi.getNotice();
      return data as PrivacyNotice;
    },
    staleTime: 60 * 60 * 1000,
  });

  const parsed = data?.body ? parseNotice(data.body) : null;
  const structured = (parsed?.sections.length ?? 0) >= 3;

  const printAll = () => {
    bodyRef.current?.querySelectorAll('details').forEach((d) => { d.open = true; });
    window.print();
  };

  return (
    <div>
      <section className="relative overflow-hidden bg-dark text-white">
        <div className="relative mx-auto max-w-[880px] px-6 py-12 sm:py-16">
          <span className="section-label-pink inline-flex">Legal</span>
          <h1 className="mt-3 font-head text-fluid-3xl font-black leading-tight tracking-[-0.02em]">
            {data?.title ?? 'Aviso de Privacidad'}
          </h1>
          {data?.effective_date && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/60">
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
          <div ref={bodyRef} className="mx-auto max-w-[820px]">
            {/* Resumen rápido — informativo; el texto oficial rige abajo */}
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3 print:hidden">
              {[
                { icon: Building2, label: 'Responsable', value: 'ADCE EDUCACIÓN, A.C. (Colegio Interlaken)' },
                { icon: ShieldCheck, label: 'Sus derechos', value: 'Acceso · Rectificación · Cancelación · Oposición (ARCO)' },
                { icon: Phone, label: 'Ejercerlos', value: '(5255) 5379-1188 · colegio@interlaken.com.mx' },
              ].map((c) => (
                <div key={c.label} className="rounded-xl2 border border-ink/10 bg-cream-2 p-4">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-subtle">
                    <c.icon className="h-3.5 w-3.5 text-green-dark" aria-hidden="true" /> {c.label}
                  </p>
                  <p className="mt-1.5 text-sm font-medium leading-snug text-ink">{c.value}</p>
                </div>
              ))}
            </div>

            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
              <p className="text-xs text-muted">
                Resumen informativo — el texto oficial completo es el siguiente.
              </p>
              <button
                type="button"
                onClick={printAll}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-ink/15 px-4 text-sm font-semibold text-muted transition-colors hover:border-green hover:text-green-dark"
              >
                <Printer className="h-4 w-4" aria-hidden="true" /> Imprimir / guardar PDF
              </button>
            </div>

            {structured && parsed ? (
              <>
                {parsed.intro.map((p) => (
                  <p key={p.slice(0, 40)} className="mb-4 whitespace-pre-line text-[15px] leading-relaxed text-ink/90">
                    {p}
                  </p>
                ))}
                <div className="mt-6 space-y-3">
                  {parsed.sections.map((s, i) => {
                    const Icon = sectionIcon(s.title);
                    return (
                      <details
                        key={s.title}
                        open={i === 0}
                        className="group rounded-xl2 border border-ink/10 bg-white open:shadow-card"
                      >
                        <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-green/10 text-green-dark">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="flex-1 text-sm font-semibold normal-case text-ink">
                            {s.title.charAt(0) + s.title.slice(1).toLowerCase()}
                          </span>
                          <ChevronDown
                            className="h-4 w-4 flex-shrink-0 text-subtle transition-transform group-open:rotate-180 motion-reduce:transition-none"
                            aria-hidden="true"
                          />
                        </summary>
                        <div className="border-t border-ink/5 px-4 py-4 sm:px-[60px]">
                          {s.paragraphs.map((p) => (
                            <p key={p.slice(0, 40)} className="mb-3 whitespace-pre-line text-[15px] leading-relaxed text-ink/90 last:mb-0">
                              {p}
                            </p>
                          ))}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="whitespace-pre-line text-[15px] leading-relaxed text-ink/90">
                {data.body}
              </div>
            )}

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
