/**
 * Admisiones · Preguntas frecuentes: the explorer (search, topic filter,
 * accordion and FAQPage structured data). Loaded on demand by the section in
 * ./admisiones, which keeps its defaults and fields; every word is a prop.
 */
import { useMemo, useState } from 'react';
import { Seo } from '@/components/seo/Seo';
import { Search, Plus } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { Illustration, wash } from '@/components/ui/Illustration';
import { isIllustration, type IllustrationName } from '@/lib/illustrations';
import { useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, fill } from './kit';

interface FaqItem { cat?: string; q?: string; a?: string }


/**
 * Explorador de preguntas frecuentes: buscador + filtro por tema (barra
 * lateral) y lista acordeón. Sin dependencias; mobile-first (la barra se
 * apila sobre la lista en teléfonos).
 */

/** Key of the «every topic» filter; never a real topic name. */
const ALL_TOPICS = '\u0000all';

/** `c(prop)`: the explorer's own words, edited in Contenido ({n} and {total} are filled in). */
function FaqExplorer({ faqs, c, emptyLink, art }: { faqs: Required<FaqItem>[]; c: (prop: string) => string; emptyLink: CmsLink; art?: IllustrationName }) {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState(ALL_TOPICS);
  const topics = useMemo(() => [ALL_TOPICS, ...Array.from(new Set(faqs.map((f) => f.cat)))], [faqs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return faqs.filter(
      (f) =>
        (topic === ALL_TOPICS || f.cat === topic) &&
        (!q || f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q)),
    );
  }, [faqs, query, topic]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      {/* Barra lateral */}
      <aside className="self-start lg:sticky lg:top-24">
        <div className="overflow-hidden rounded-md bg-white shadow-card">
          {/* Desktop: the illustration heads the filter column (phones go straight to the questions). */}
          {art && (
            <div className="hidden items-center justify-center py-4 lg:flex" style={{ background: wash('var(--green)', 10) }}>
              <Illustration name={art} size={104} />
            </div>
          )}
          <div className="p-4 sm:p-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={c('search')}
                aria-label={c('searchLabel')}
                className="input-field min-h-[44px] pl-9 text-base"
              />
            </div>

            <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-subtle">
              {c('filterTitle')}
            </p>
            <div className="mt-2 flex flex-col gap-1">
              {topics.map((t) => {
                const count = t === ALL_TOPICS ? faqs.length : faqs.filter((f) => f.cat === t).length;
                const active = topic === t;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTopic(t)}
                    className={`flex min-h-[42px] items-center justify-between gap-2 rounded-sm px-3 text-sm font-semibold transition-colors ${
                      active
                        ? 'bg-purple text-white shadow-purple'
                        : 'text-ink/80 hover:bg-purple/[0.07] hover:text-purple'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-white' : 'bg-purple/40'}`}
                        aria-hidden="true"
                      />
                      {t === ALL_TOPICS ? c('all') : t}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        active ? 'bg-white/20 text-white' : 'bg-purple/10 text-purple'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mt-5 border-t border-ink/5 pt-3 text-xs uppercase tracking-wide text-subtle">
              {fill(c('count'), { n: visible.length, total: faqs.length })}
            </p>
          </div>
        </div>
      </aside>

      {/* Lista de preguntas */}
      <div className="min-w-0">
        {visible.length === 0 ? (
          <div className="rounded-md bg-white p-8 text-center shadow-card">
            <p className="text-base text-muted">
              {c('empty')}{' '}
              <CmsAnchor link={emptyLink} className="font-semibold text-green-dark underline" />{' '}
              {c('emptyAfter')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-ink/5 overflow-hidden rounded-md bg-white shadow-card">
            {visible.map((f, i) => (
              <details key={`${i}-${f.q}`} className="group">
                <summary className="flex cursor-pointer items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-cream-2/60 sm:px-6 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-purple">
                      {f.cat}
                    </span>
                    <span className="mt-0.5 block font-head text-base font-bold leading-snug text-ink sm:text-[17px]">
                      {f.q}
                    </span>
                  </span>
                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm bg-purple/10 text-purple transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </span>
                </summary>
                <p className="max-w-[68ch] px-5 pb-5 text-base leading-relaxed text-muted sm:px-6">{f.a}</p>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AdmFaqView(p: { eyebrow?: string; title?: string; items?: FaqItem[]; emptyLink?: CmsLink; illustration?: unknown; [copy: string]: unknown }) {
  const t = useTokens();
  // The one chosen in the editor; «none» hides it; nothing chosen (saved before the field existed) keeps the lamp.
  const art = p.illustration === 'none' ? undefined : isIllustration(p.illustration) ? p.illustration : 'ideas';
  const emptyLink = asLink(p.emptyLink);
  const raw = asList<FaqItem>(p.items);
  const faqs = useMemo(
    () => raw.filter((f) => f.q).map((f) => ({ cat: t(f.cat), q: t(f.q), a: t(f.a) })),
    [raw, t],
  );
  // The questions are also emitted as FAQPage structured data.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  return (
    <Section bg="white">
      {faqs.length > 0 && <Seo jsonLd={jsonLd} />}
      {(p.eyebrow || p.title) && (
        <Reveal className="mb-8 text-center sm:mb-10">
          {p.eyebrow && <span className="section-label-green inline-flex">{t(p.eyebrow)}</span>}
          <h2 className="font-head text-fluid-3xl font-extrabold tracking-tight text-ink">{t(p.title)}</h2>
        </Reveal>
      )}
      <FaqExplorer faqs={faqs} c={(k) => t(p[k])} emptyLink={{ ...emptyLink, label: t(emptyLink.label) }} art={art} />
    </Section>
  );
}
