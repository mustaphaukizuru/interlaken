/**
 * Home sections below the fold (formerly components/public/HomeBelowFold).
 * Lazily loaded so a cold visit downloads the hero first; every text, image
 * and list is a prop with the original copy as its default (./home.tsx).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowRight, Award, Check, FlaskConical, Heart, Languages, Mail, Palette, Send, ShieldCheck, Star, Trophy } from 'lucide-react';
import type { Variants } from 'framer-motion';
import { m } from '@/lib/motion';
import { contactApi, contentApi } from '@/services/api';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { Testimonials } from '@/components/public/Testimonials';
import { Section } from '@/components/ui/Section';
import { VideoEmbed } from '@/components/ui/VideoEmbed';
import { CARD_SIZES } from '@/lib/images';
import { iconResolver } from '../iconRuntime';
import { cmsColor, imageSrc, imageSrcSet, useMediaAlt, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor } from './kit';
import { withMotion } from './motion';

/** The icons this module's defaults use; any other curated icon loads on demand. */
const cmsIcon = iconResolver({ Languages, Trophy, Palette, FlaskConical, Heart, Award });

const VIEWPORT = { once: true, margin: '0px 0px -60px 0px' } as const;

const sectionReveal: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};
const fadeRight: Variants = {
  hidden: { opacity: 0, x: -24 },
  show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};
const fadeLeft: Variants = {
  hidden: { opacity: 0, x: 24 },
  show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: 'easeOut' } },
};
const staggerGroup: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  (e.currentTarget as HTMLImageElement).style.display = 'none';
}

type Img = { image?: number | string };

/* ── Nuestra comunidad ──────────────────────────────────────────────────── */
interface AboutProps { eyebrow?: string; title?: string; text?: string; cta?: CmsLink; image1?: number | string; image2?: number | string; image3?: number | string; badgeValue?: string; badgeLabel?: string }
function HomeAboutView(p: AboutProps) {
  const t = useTokens();
  const altOf = useMediaAlt();
  const cta = asLink(p.cta);
  const imgs = [p.image1, p.image2, p.image3];
  return (
    <Section bg="white">
      <m.div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-11" variants={staggerGroup} initial="hidden" whileInView="show" viewport={VIEWPORT}>
        <m.div variants={fadeRight}>
          {p.eyebrow && <span className="section-label-purple inline-flex">{t(p.eyebrow)}</span>}
          <h2 className="font-head font-extrabold text-fluid-4xl leading-tight tracking-[-0.03em] text-ink">{t(p.title)}</h2>
          {p.text && <p className="mt-4 text-base leading-relaxed text-muted">{t(p.text)}</p>}
          <CmsAnchor link={cta} className="btn-outline mt-6 focus-visible:ring-2 focus-visible:ring-purple focus-visible:ring-offset-2">{cta.label} <ArrowRight size={16} /></CmsAnchor>
        </m.div>
        <m.div variants={fadeLeft} className="relative">
          <div className="grid grid-cols-2 gap-3.5">
            {imgs[0] && <img src={imageSrc(imgs[0], 'md')} srcSet={imageSrcSet(imgs[0])} sizes={CARD_SIZES} alt={altOf(imgs[0])} loading="lazy" decoding="async" width={400} height={400} className="row-span-2 h-full max-w-full rounded-2xl object-cover" onError={hideOnError} />}
            {imgs[1] && <img src={imageSrc(imgs[1], 'md')} srcSet={imageSrcSet(imgs[1])} sizes={CARD_SIZES} alt={altOf(imgs[1])} loading="lazy" decoding="async" width={400} height={186} className="h-[93px] w-full max-w-full rounded-2xl object-cover" onError={hideOnError} />}
            {imgs[2] && <img src={imageSrc(imgs[2], 'md')} srcSet={imageSrcSet(imgs[2])} sizes={CARD_SIZES} alt={altOf(imgs[2])} loading="lazy" decoding="async" width={400} height={186} className="h-[93px] w-full max-w-full rounded-2xl object-cover" onError={hideOnError} />}
          </div>
          {p.badgeValue && (
            <div className="absolute -bottom-4 right-0 flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3.5 shadow-purple sm:-right-2">
              <div className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-purple/10"><Star size={20} color="var(--purple)" /></div>
              <div>
                <div className="font-head text-xl font-extrabold leading-none text-ink">{t(p.badgeValue)}</div>
                <div className="text-[11.5px] text-muted">{t(p.badgeLabel)}</div>
              </div>
            </div>
          )}
        </m.div>
      </m.div>
    </Section>
  );
}

/* ── Video institucional ────────────────────────────────────────────────── */
interface VideoProps { eyebrow?: string; title?: string; text?: string; video?: string; primary?: CmsLink; secondary?: CmsLink }
function HomeVideoView(p: VideoProps) {
  const t = useTokens();
  const settings = useSiteSettings();
  // Empty = the institutional video from Ajustes; no video at all hides the band.
  const url = (p.video || settings.video_url || '').trim();
  if (!url) return null;
  const primary = asLink(p.primary);
  const secondary = asLink(p.secondary);
  return (
    <Section bg="dark">
      <m.div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12" variants={staggerGroup} initial="hidden" whileInView="show" viewport={VIEWPORT}>
        <m.div variants={fadeRight} className="order-2 lg:order-1">
          <VideoEmbed url={url} />
        </m.div>
        <m.div variants={fadeLeft} className="order-1 text-center lg:order-2 lg:text-left">
          {p.eyebrow && <span className="section-label-pink inline-flex">{t(p.eyebrow)}</span>}
          <h2 className="font-head text-fluid-4xl font-extrabold tracking-[-0.03em] text-white">{t(p.title)}</h2>
          {p.text && <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-white/75 lg:mx-0">{t(p.text)}</p>}
          <div className="mt-7 flex flex-wrap justify-center gap-3 lg:justify-start">
            <CmsAnchor link={primary} className="btn-pink min-h-[44px]">{primary.label} <ArrowRight size={16} aria-hidden="true" /></CmsAnchor>
            <CmsAnchor link={secondary} className="btn-ghost min-h-[44px]" />
          </div>
        </m.div>
      </m.div>
    </Section>
  );
}

/* ── Niveles ────────────────────────────────────────────────────────────── */
interface LevelItem extends Img { name?: string; text?: string; color?: string; href?: string; linkLabel?: string }
interface LevelsProps { eyebrow?: string; title?: string; text?: string; items?: LevelItem[]; cta?: CmsLink }
function HomeLevelsView(p: LevelsProps) {
  const t = useTokens();
  const altOf = useMediaAlt();
  const cta = asLink(p.cta);
  return (
    <Section bg="cream">
      <m.div variants={sectionReveal} initial="hidden" whileInView="show" viewport={VIEWPORT} className="mb-10 text-center">
        {p.eyebrow && <span className="section-label-green inline-flex">{t(p.eyebrow)}</span>}
        <h2 className="font-head font-extrabold text-fluid-4xl tracking-[-0.03em] text-ink">{t(p.title)}</h2>
        {p.text && <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-muted">{t(p.text)}</p>}
      </m.div>
      <m.div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" variants={staggerGroup} initial="hidden" whileInView="show" viewport={VIEWPORT}>
        {asList<LevelItem>(p.items).map((l, i) => {
          const accent = cmsColor(l.color);
          return (
            <m.div key={i} variants={sectionReveal}>
              <div className="card hover-lift overflow-hidden !p-0">
                <div className="relative h-[180px]">
                  {l.image && <img src={imageSrc(l.image, 'md')} srcSet={imageSrcSet(l.image)} sizes={CARD_SIZES} alt={altOf(l.image, l.name)} loading="lazy" decoding="async" width={400} height={180} className="h-full w-full max-w-full object-cover" onError={hideOnError} />}
                  <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 40%, color-mix(in srgb, ${accent} 87%, transparent) 100%)` }} />
                  <h3 className="absolute bottom-3.5 left-[18px] font-head text-[22px] font-extrabold text-white">{t(l.name)}</h3>
                </div>
                <div className="px-5 py-[18px]">
                  {l.text && <p className="text-sm leading-relaxed text-muted">{t(l.text)}</p>}
                  <CmsAnchor link={{ href: l.href }} className="mt-3.5 inline-flex items-center gap-[5px] text-[13.5px] font-bold text-ink focus-visible:ring-2 focus-visible:ring-offset-2 rounded">{t(l.linkLabel) || `Conocer ${t(l.name)}`} <ArrowRight size={14} style={{ color: accent }} /></CmsAnchor>
                </div>
              </div>
            </m.div>
          );
        })}
      </m.div>
      {cta.href && (
        <m.div variants={sectionReveal} initial="hidden" whileInView="show" viewport={VIEWPORT} className="mt-8 text-center">
          <CmsAnchor link={cta} className="btn-outline inline-flex focus-visible:ring-2 focus-visible:ring-green focus-visible:ring-offset-2">{cta.label} <ArrowRight size={16} /></CmsAnchor>
        </m.div>
      )}
    </Section>
  );
}

/* ── Programas ──────────────────────────────────────────────────────────── */
interface ProgramItem extends Img { name?: string; color?: string; icon?: string }
interface ProgramsProps { eyebrow?: string; title?: string; items?: ProgramItem[]; footnote?: string }
function HomeProgramsView(p: ProgramsProps) {
  const t = useTokens();
  const altOf = useMediaAlt();
  return (
    <Section bg="white">
      <m.div variants={sectionReveal} initial="hidden" whileInView="show" viewport={VIEWPORT} className="mb-11 text-center">
        {p.eyebrow && <span className="section-label-pink inline-flex">{t(p.eyebrow)}</span>}
        <h2 className="font-head font-extrabold text-fluid-4xl tracking-[-0.03em] text-ink">{t(p.title)}</h2>
      </m.div>
      <m.div className="grid grid-cols-2 gap-7 sm:grid-cols-2 lg:grid-cols-4" variants={staggerGroup} initial="hidden" whileInView="show" viewport={VIEWPORT}>
        {asList<ProgramItem>(p.items).map((it, i) => {
          const accent = cmsColor(it.color);
          const Icon = cmsIcon(it.icon);
          return (
            <m.div key={i} variants={sectionReveal} className="text-center">
              <div className="relative mx-auto aspect-square w-full max-w-[150px]">
                <div className="absolute inset-0 rounded-full" style={{ background: `color-mix(in srgb, ${accent} 8%, transparent)` }} />
                <div className="absolute inset-2.5 overflow-hidden rounded-full" style={{ border: `3px solid ${accent}`, boxShadow: `0 16px 30px -14px color-mix(in srgb, ${accent} 53%, transparent)` }}>
                  {it.image && <img src={imageSrc(it.image, 'md')} srcSet={imageSrcSet(it.image)} sizes={CARD_SIZES} alt={altOf(it.image, it.name)} loading="lazy" decoding="async" width={150} height={150} className="h-full w-full max-w-full object-cover" onError={hideOnError} />}
                </div>
                <div className="absolute bottom-0.5 right-0.5 flex h-10 w-10 items-center justify-center rounded-full shadow-[0_8px_18px_-6px_rgba(0,0,0,0.4)]" style={{ background: accent }}>
                  <Icon size={19} color="white" />
                </div>
              </div>
              <h3 className="mt-[18px] font-head text-[17px] font-bold text-ink">{t(it.name)}</h3>
            </m.div>
          );
        })}
      </m.div>
      {p.footnote && (
        <m.div variants={sectionReveal} initial="hidden" whileInView="show" viewport={VIEWPORT} className="mt-10 text-center">
          <p className="text-[15px] text-muted">{t(p.footnote)}</p>
        </m.div>
      )}
    </Section>
  );
}

/* ── Promociones (par de tarjetas de color) ─────────────────────────────── */
interface PromoItem { label?: string; title?: string; text?: string; link?: CmsLink; color?: string; color2?: string; icon?: string }
function HomePromosView({ items }: { items?: PromoItem[] }) {
  const t = useTokens();
  return (
    <Section bg="cream">
      <m.div className="grid grid-cols-1 gap-6 lg:grid-cols-2" variants={staggerGroup} initial="hidden" whileInView="show" viewport={VIEWPORT}>
        {asList<PromoItem>(items).map((it, i) => {
          const Icon = cmsIcon(it.icon);
          const link = asLink(it.link);
          return (
            <m.div key={i} variants={i % 2 === 0 ? fadeRight : fadeLeft}>
              <div className="hover-lift relative flex min-h-[260px] flex-col justify-between overflow-hidden rounded-xl3 px-8 py-10 text-white shadow-[0_24px_48px_-20px_rgba(16,12,40,0.4)] sm:px-9" style={{ background: `linear-gradient(135deg, ${cmsColor(it.color)} 0%, ${cmsColor(it.color2, cmsColor(it.color))} 100%)` }}>
                <div className="pointer-events-none absolute -top-12 -right-12 h-[200px] w-[200px] rounded-full bg-white/[0.08]" />
                <Icon size={40} color="rgba(255,255,255,0.9)" className="relative" />
                <div className="relative mt-5">
                  {it.label && <span className="text-xs font-bold uppercase tracking-[1.5px] opacity-85">{t(it.label)}</span>}
                  <h3 className="mt-2 font-head text-[26px] font-extrabold leading-tight tracking-[-0.02em]">{t(it.title)}</h3>
                  {it.text && <p className="mt-3 max-w-[420px] text-[14.5px] leading-relaxed opacity-90">{t(it.text)}</p>}
                  <CmsAnchor link={link} className="mt-5 inline-flex items-center gap-1.5 border-b-2 border-white/50 pb-0.5 text-sm font-bold text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 rounded-sm">{link.label} <ArrowRight size={15} /></CmsAnchor>
                </div>
              </div>
            </m.div>
          );
        })}
      </m.div>
    </Section>
  );
}

/* ── Por qué Interlaken ─────────────────────────────────────────────────── */
interface StrengthItem { icon?: string; color?: string; title?: string; text?: string }
function HomeStrengthsView(p: { eyebrow?: string; title?: string; items?: StrengthItem[] }) {
  const t = useTokens();
  return (
    <Section bg="white">
      <m.div variants={sectionReveal} initial="hidden" whileInView="show" viewport={VIEWPORT} className="mb-11 text-center">
        {p.eyebrow && <span className="section-label-purple inline-flex">{t(p.eyebrow)}</span>}
        <h2 className="font-head font-extrabold text-fluid-4xl tracking-[-0.03em] text-ink">{t(p.title)}</h2>
      </m.div>
      <m.div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" variants={staggerGroup} initial="hidden" whileInView="show" viewport={VIEWPORT}>
        {asList<StrengthItem>(p.items).map((s, i) => {
          const color = cmsColor(s.color);
          const Icon = cmsIcon(s.icon);
          return (
            <m.div key={i} variants={sectionReveal} className="h-full">
              <div className="card hover-lift flex h-full flex-col gap-[18px]">
                <div className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px]" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
                  <Icon size={26} color={color} />
                </div>
                <h3 className="font-head text-[19px] font-bold text-ink">{t(s.title)}</h3>
                {s.text && <p className="flex-1 text-[15px] leading-relaxed text-muted">{t(s.text)}</p>}
              </div>
            </m.div>
          );
        })}
      </m.div>
    </Section>
  );
}

/* ── Testimonios (BACKLOG P2-15): the band disappears with no quotes ───── */
function HomeTestimonialsView(p: { eyebrow?: string; title?: string; limit?: number }) {
  const t = useTokens();
  const { data } = useQuery({
    queryKey: ['testimonials'],
    queryFn: async () => (await contentApi.getTestimonials()).data as unknown[],
    staleTime: 5 * 60_000,
    retry: false,
  });
  if ((data ?? []).length === 0) return null;
  return <Section bg="cream"><Testimonials eyebrow={t(p.eyebrow)} title={t(p.title)} limit={typeof p.limit === 'number' && p.limit > 0 ? p.limit : 3} /></Section>;
}

/* ── Galería (franja) ───────────────────────────────────────────────────── */
interface GalleryProps { eyebrow?: string; title?: string; images?: (Img & { caption?: string })[]; cta?: CmsLink }
function HomeGalleryView(p: GalleryProps) {
  const t = useTokens();
  const altOf = useMediaAlt();
  const cta = asLink(p.cta);
  const href = cta.href || '/galeria';
  return (
    <Section bg="dark">
      <m.div variants={sectionReveal} initial="hidden" whileInView="show" viewport={VIEWPORT} className="mb-9 text-center">
        {p.eyebrow && <span className="section-label-pink inline-flex">{t(p.eyebrow)}</span>}
        <h2 className="font-head font-extrabold text-fluid-4xl tracking-[-0.03em] text-white">{t(p.title)}</h2>
      </m.div>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
        {asList<Img & { caption?: string }>(p.images).filter((im) => im.image).map((im, i) => (
          <Link key={i} to={href} aria-label="Ver la galería completa" className="group block overflow-hidden rounded-[14px] border border-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <img src={imageSrc(im.image, 'md')} srcSet={imageSrcSet(im.image)} sizes="(min-width: 640px) 280px, 45vw" alt={altOf(im.image, im.caption ?? '')} loading="lazy" width={280} height={150} className="h-[120px] w-full max-w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none sm:h-[150px]" onError={hideOnError} />
          </Link>
        ))}
      </div>
      {cta.label && (
        <div className="mt-7 text-center">
          <CmsAnchor link={{ ...cta, href }} className="btn-ghost min-h-[44px]">{cta.label} <ArrowRight size={16} /></CmsAnchor>
        </div>
      )}
    </Section>
  );
}

/* ── Solicite informes (lead capture) ───────────────────────────────────── */
interface LeadProps { title?: string; text?: string; button?: string; success?: string; subject?: string }
function LeadForm(p: LeadProps) {
  const t = useTokens();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      await contactApi.send({
        name: name.trim(),
        email: email.trim(),
        subject: p.subject || 'Solicitud de informes',
        message: `${name.trim()} solicita informes desde la página de inicio.`,
      });
      setDone(true);
      toast.success('¡Gracias! Te contactaremos muy pronto.');
    } catch {
      toast.error('No fue posible enviar tu solicitud. Intenta de nuevo.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-xl3 bg-gradient-to-br from-purple to-brand-500 text-white px-6 py-10 text-center sm:px-10 sm:py-12 lg:py-14">
      <div className="pointer-events-none absolute -top-16 -right-10 hidden h-56 w-56 rounded-full bg-white/[0.06] sm:block" />
      <div className="relative mx-auto max-w-[620px]">
        <div className="mx-auto mb-4 inline-flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-white/[0.14]">
          <Mail size={24} />
        </div>
        <h2 className="font-head font-extrabold text-fluid-3xl tracking-tight">{t(p.title)}</h2>
        {p.text && <p className="mt-2.5 text-base leading-relaxed opacity-90">{t(p.text)}</p>}
        {done ? (
          <div role="status" className="mt-6 inline-flex items-center gap-2 rounded-full bg-green-400/20 px-5 py-3 font-semibold">
            <Check size={18} color="var(--green-mid)" strokeWidth={3} /> {t(p.success) || '¡Solicitud recibida! Le contactaremos pronto.'}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 flex flex-col flex-wrap justify-center gap-3 text-left sm:mt-6 sm:flex-row sm:items-end">
            {/* Visible labels, not placeholders: the placeholder vanishes on the
                first keystroke, leaving the field unidentified on review and for
                voice control. */}
            <label className="min-w-0 flex-1 sm:flex-[1_1_180px]">
              <span className="mb-1.5 block text-sm font-medium text-white/90">Nombre completo</span>
              <input
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-full border-none px-5 py-3.5 text-[15px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-pink focus-visible:ring-offset-2 focus-visible:ring-offset-purple"
              />
            </label>
            <label className="min-w-0 flex-1 sm:flex-[1_1_220px]">
              <span className="mb-1.5 block text-sm font-medium text-white/90">Correo electrónico</span>
              <input
                type="email" inputMode="email" autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-full border-none px-5 py-3.5 text-[15px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-pink focus-visible:ring-offset-2 focus-visible:ring-offset-purple"
              />
            </label>
            <button
              type="submit"
              className="btn btn-lg shrink-0 justify-center bg-pink text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-purple disabled:opacity-70"
              disabled={sending}
            >
              {sending ? 'Enviando…' : <>{t(p.button) || 'Solicitar'} <Send size={16} /></>}
            </button>
          </form>
        )}
        {!done && (
          // LFPDPPP notice at the point of collection (legal copy: not editable).
          <p className="mx-auto mt-4 flex max-w-[520px] items-start justify-center gap-2 text-xs leading-relaxed text-white/80">
            <ShieldCheck size={15} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>
              Protegemos sus datos conforme a la LFPDPPP y solo los usamos para atender su solicitud. Consulte el{' '}
              <Link to="/aviso-de-privacidad" className="font-semibold text-white underline underline-offset-2">
                Aviso de Privacidad
              </Link>.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
function HomeLeadView(p: LeadProps) {
  return (
    <Section bg="white">
      <m.div variants={sectionReveal} initial="hidden" whileInView="show" viewport={VIEWPORT}>
        <LeadForm {...p} />
      </m.div>
    </Section>
  );
}

/* ── Llamado final ──────────────────────────────────────────────────────── */
interface CtaProps { title?: string; text?: string; primary?: CmsLink; secondary?: CmsLink }
export function HomeCta(p: CtaProps) {
  const t = useTokens();
  const primary = asLink(p.primary);
  return (
    <Section bg="gradient" spacing="sm" className="text-center">
      <Star size={28} className="mx-auto mb-3" />
      <h2 className="font-head font-black text-fluid-4xl tracking-[-0.03em]">{t(p.title)}</h2>
      {p.text && <p className="mx-auto mt-3 max-w-[560px] text-[17px] opacity-90">{t(p.text)}</p>}
      <div className="mt-7 flex flex-wrap justify-center gap-3.5">
        <CmsAnchor link={primary} className="btn btn-lg bg-white text-purple focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-purple">{primary.label} <ArrowRight size={17} /></CmsAnchor>
        <CmsAnchor link={asLink(p.secondary)} className="btn-ghost btn-lg focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-purple" />
      </div>
    </Section>
  );
}

export const HomeAbout = withMotion(HomeAboutView);
export const HomeVideo = withMotion(HomeVideoView);
export const HomeLevels = withMotion(HomeLevelsView);
export const HomePrograms = withMotion(HomeProgramsView);
export const HomePromos = withMotion(HomePromosView);
export const HomeStrengths = withMotion(HomeStrengthsView);
export const HomeTestimonials = HomeTestimonialsView;
export const HomeGallery = withMotion(HomeGalleryView);
export const HomeLead = withMotion(HomeLeadView);
