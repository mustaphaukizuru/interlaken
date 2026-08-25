import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, Users, GraduationCap, CalendarDays } from 'lucide-react';
import type { Variants } from 'framer-motion';
import { CURRENT_CYCLE, SCHOOL_YEARS } from '@/lib/siteMeta';
import { m, SiteMotionProvider } from '@/lib/motion';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Container } from '@/components/ui/Container';
import Logo from '@/components/ui/Logo';
import { HeroVideo } from '@/components/public/HeroVideo';

const HomeBelowFold = lazy(() => import('@/components/public/HomeBelowFold'));

const STATS = [
  { value: '1,200+', label: 'Alumnos', color: 'var(--pink)', icon: Users },
  { value: '80+', label: 'Maestros', color: 'var(--green)', icon: GraduationCap },
  { value: String(SCHOOL_YEARS), label: 'Años', color: 'var(--purple-mid)', icon: CalendarDays },
  { value: '95%', label: 'Aprovechamiento', color: 'var(--green-mid)', icon: TrendingUp },
];

// Official nivel colors (school instruction 2026-08-21); cards link to each nivel page.



/**
 * Institutional strengths — defensible, verifiable school credentials that
 * replace prior placeholder testimonials (fabricated social proof is banned).
 */

// Curated, explicit list — not a generated range. Building filenames from an
// index silently pointed at whatever happened to be numbered 1-8, which mixed
// brand logos in among the photographs and broke the moment a file was renamed
// or de-duplicated. Static paths are also the only kind an asset audit can check.
/* ── Motion (framer `m` — engine lazy-loaded via PublicLayout's provider) ──
 * Section reveals: fade + small rise, played once as each section approaches
 * the viewport (the negative bottom margin mirrors the sitewide Reveal feel).
 * MotionConfig reducedMotion="user" (in SiteMotionProvider) drops the
 * transforms for prefers-reduced-motion users; only opacity animates for them.
 */
const VIEWPORT = { once: true, margin: '0px 0px -60px 0px' } as const;

const sectionReveal: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};
/** Parent wrapper: carries whileInView and staggers its variant children. */

/* Hero entrance: ONE orchestrated run on first mount — headline, subline and
 * CTAs rise in (~540ms total). Opacity/transform only: no layout shift, and
 * the hero IMAGE is deliberately not animated so the LCP paint is untouched. */
/** Parent wrapper: carries whileInView and staggers its variant children. */
const staggerGroup: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const heroGroup: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const heroItem: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: 'easeOut' } },
};

export default function HomePage() {
  const settings = useSiteSettings();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  return (
    // Motion provider lives HERE (not in the shared layout) so the framer
    // runtime stays inside this lazy chunk — see lib/motion.tsx.
    <SiteMotionProvider>
    <div>
      {/* ── HERO: brand + one headline + one line + CTAs over full-bleed campus ── */}
      <HeroVideo
        className="min-h-[min(92svh,820px)] sm:min-h-[min(88svh,760px)]"
        src={settings.hero_video_url ?? ''}
        poster="/assets/court-wide.webp"
        posterAlt="Campus Colegio Interlaken"
        reducedMotion={reducedMotion}
      >
        <div
          className="pointer-events-none absolute -top-32 -left-24 hidden h-[420px] w-[420px] rounded-full sm:block"
          style={{ background: 'radial-gradient(circle, rgba(64,26,142,0.4), transparent 68%)' }}
        />
        {/* pb on phones clears the fixed "Agendar visita" bar, which otherwise
            sits on top of the secondary hero CTA at the fold. */}
        <Container className="relative w-full !pb-28 !pt-28 sm:!pb-16 sm:!pt-32 lg:!pb-[72px]">
          <m.div
            className="max-w-[640px]"
            variants={heroGroup}
            initial="hidden"
            animate="show"
          >
            <Logo variant="horizontal" theme="dark" size={56} eager className="mb-6 sm:mb-7" />
            <m.h1
              variants={heroItem}
              className="font-head font-black leading-[1.05] tracking-[-0.03em] text-fluid-5xl"
            >
              Formando líderes<br />
              <span
                style={{
                  background: 'linear-gradient(100deg, var(--pink) 0%, var(--purple-mid) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                con excelencia
              </span>
            </m.h1>
            <m.p
              variants={heroItem}
              className="mt-4 max-w-[480px] text-[16px] leading-relaxed text-white/75 sm:text-[17px]"
            >
              Educación bilingüe en Tlalnepantla, de preescolar a secundaria — ciclo {CURRENT_CYCLE}.
            </m.p>
            <m.div
              variants={heroItem}
              className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-3.5"
            >
              <Link
                to="/pre-registro"
                className="btn-pink btn-lg justify-center focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
              >
                Inicie su pre-registro <ArrowRight size={17} />
              </Link>
              <Link
                to="/login"
                className="btn-ghost btn-lg justify-center focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-dark"
              >
                Portal Familias
              </Link>
            </m.div>
          </m.div>
        </Container>
      </HeroVideo>

      {/* ── STAT BANNER ── */}
      <section className="bg-dark-2 py-10 text-white">
        <Container>
          <m.div
            className="grid grid-cols-2 gap-5 sm:grid-cols-2 lg:grid-cols-4"
            variants={staggerGroup}
            initial="hidden"
            whileInView="show"
            viewport={VIEWPORT}
          >
            {STATS.map((s) => (
              <m.div key={s.label} variants={sectionReveal} className="flex items-center gap-3 sm:gap-4">
                <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px]" style={{ background: `color-mix(in srgb, ${s.color} 13%, transparent)` }}>
                  <s.icon size={24} color={s.color} />
                </div>
                <div>
                  <div className="font-head text-[32px] font-black leading-none tracking-[-0.03em]" style={{ color: s.color }}>{s.value}</div>
                  <div className="mt-[3px] text-[13px] text-white/60">{s.label}</div>
                </div>
              </m.div>
            ))}
          </m.div>
        </Container>
      </section>

      {/* Below the fold: lazily mounted so the first paint ships the hero and
          the programs, not the gallery and the lead form. */}
      <Suspense fallback={<div className="min-h-[60vh]" />}>
        <HomeBelowFold />
      </Suspense>
    </div>
    </SiteMotionProvider>
  );
}
