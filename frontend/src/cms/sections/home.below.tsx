/**
 * Home sections below the fold (formerly components/public/HomeBelowFold).
 * Lazily loaded so a cold visit downloads the hero first; every text, image
 * and list is a prop with the original copy as its default (./home.tsx).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowRight, Award, Check, FlaskConical, Heart, Languages, Mail, Palette, Send, ShieldCheck, Star, Trophy } from 'lucide-react';
import type { Variants } from 'framer-motion';
import { m } from '@/lib/motion';
import { contactApi, contentApi } from '@/services/api';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { Testimonials } from '@/components/public/Testimonials';
import { Section } from '@/components/ui/Section';
import { VideoEmbed } from '@/components/ui/VideoEmbed';
import { parseVideoUrl } from '@/lib/videoEmbed';
import { Illustration, wash } from '@/components/ui/Illustration';
import { assetSrcSet, CARD_SIZES } from '@/lib/images';
import { isIllustration, type IllustrationName } from '@/lib/illustrations';
import { resolveIllustration } from '@/lib/illustrationTopics';
import { iconResolver } from '../iconRuntime';
import { cmsColor, imageSrc, imageSrcSet, useMediaAlt, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, fill } from './kit';
import { withMotion } from './motion';

/** The icons this module's defaults use; any other curated icon loads on demand. */
const cmsIcon = iconResolver({ Languages, Trophy, Palette, FlaskConical, Heart, Award });

const VIEWPORT = { once: true, margin: '0px 0px -60px 0px' } as const;

// Motion standard (DESIGN.md §3.5): rise/slide ≤ 12px, ≤ 300ms, stagger 60ms, standard ease.
// Reduced motion is honoured by SiteMotionProvider (MotionConfig reducedMotion="user").
const EASE = [0.4, 0, 0.2, 1] as const;
const sectionReveal: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};
const fadeRight: Variants = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE } },
};
const fadeLeft: Variants = {
  hidden: { opacity: 0, x: 12 },
  show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE } },
};
const staggerGroup: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  (e.currentTarget as HTMLImageElement).style.display = 'none';
}

type Img = { image?: number | string };

/**
 * A card's illustration (media round, owner 2026-11-22): the one chosen in the
 * editor; «none» shows the icon instead; content saved before the field existed
 * takes the one that matches its icon, then its title.
 */
const ART_BY_ICON: Record<string, IllustrationName> = {
  Award: 'academico', Languages: 'mundo', Globe2: 'mundo', Heart: 'logro', Users: 'comunidad',
  Star: 'logro', ShieldCheck: 'academico', GraduationCap: 'academico', Sparkles: 'ideas',
};
function cardArt(chosen: unknown, icon: unknown, title: string, byIcon: Record<string, IllustrationName> = ART_BY_ICON): IllustrationName | undefined {
  if (chosen === 'none') return undefined;
  if (isIllustration(chosen)) return chosen;
  return (typeof icon === 'string' ? byIcon[icon] : undefined) ?? resolveIllustration(undefined, title);
}
/** The promo pair reads «bilingual» and «community» where the respaldo cards read «world» and «achievement». */
const PROMO_ART: Record<string, IllustrationName> = { ...ART_BY_ICON, Languages: 'bilingue', Globe2: 'bilingue', Heart: 'comunidad' };

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
            {imgs[0] && <img src={imageSrc(imgs[0], 'md')} srcSet={imageSrcSet(imgs[0])} sizes={CARD_SIZES} alt={altOf(imgs[0])} loading="lazy" decoding="async" width={400} height={400} className="row-span-2 h-full w-full max-w-full rounded-md object-cover shadow-card" onError={hideOnError} />}
            {imgs[1] && <img src={imageSrc(imgs[1], 'md')} srcSet={imageSrcSet(imgs[1])} sizes={CARD_SIZES} alt={altOf(imgs[1])} loading="lazy" decoding="async" width={400} height={186} className="h-[136px] w-full max-w-full rounded-md object-cover shadow-card sm:h-[180px]" onError={hideOnError} />}
            {imgs[2] && <img src={imageSrc(imgs[2], 'md')} srcSet={imageSrcSet(imgs[2])} sizes={CARD_SIZES} alt={altOf(imgs[2])} loading="lazy" decoding="async" width={400} height={186} className="h-[136px] w-full max-w-full rounded-md object-cover shadow-card sm:h-[180px]" onError={hideOnError} />}
          </div>
          {p.badgeValue && (
            <div className="absolute -bottom-4 right-0 flex items-center gap-3 rounded-md bg-white px-4 py-3.5 shadow-purple sm:-right-2">
              <div className="flex h-[42px] w-[42px] items-center justify-center rounded-md bg-purple/10"><Star size={20} color="var(--purple)" /></div>
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
interface VideoProps { eyebrow?: string; title?: string; text?: string; video?: string; poster?: number | string; clickToPlay?: boolean; primary?: CmsLink; secondary?: CmsLink }
function HomeVideoView(p: VideoProps) {
  const t = useTokens();
  const settings = useSiteSettings();
  // Empty = the institutional video from Ajustes; no video at all hides the band.
  const url = (p.video || settings.video_url || '').trim();
  if (!url) return null;
  const primary = asLink(p.primary);
  const secondary = asLink(p.secondary);
  // Ambient glow behind the card: the cover's colours, blurred (a small file is
  // plenty); without a cover, the YouTube thumbnail's.
  const parsed = parseVideoUrl(url);
  const glow = p.poster
    ? (typeof p.poster === 'string' && assetSrcSet(p.poster) ? p.poster.replace(/\.webp$/, '-480.webp') : imageSrc(p.poster, 'thumb'))
    : parsed?.provider === 'youtube' ? `https://i.ytimg.com/vi/${parsed.id}/mqdefault.jpg` : null;
  return (
    <Section bg="dark">
      <m.div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12" variants={staggerGroup} initial="hidden" whileInView="show" viewport={VIEWPORT}>
        <m.div variants={fadeRight} className="relative isolate order-2 lg:order-1">
          {glow && (
            <img
              src={glow}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              className="pointer-events-none absolute -inset-8 z-0 h-[calc(100%+4rem)] w-[calc(100%+4rem)] object-cover opacity-45 blur-3xl saturate-150"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          {/* Silent preview unless the editor chose «Esperar un clic» (older saved pages: preview). */}
          <div className="relative z-10">
            <VideoEmbed
              url={url}
              autoplay={p.clickToPlay !== true}
              poster={p.poster ? { src: imageSrc(p.poster, 'md'), srcSet: imageSrcSet(p.poster) } : undefined}
            />
          </div>
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

/**
 * The first defaults gave Preescolar the photo of the primaria court, with its
 * big «PRIMARIA» sign (fixed 2026-11-22). A page saved with that pairing shows
 * the preescolar playground instead; any other photo the school picked stays.
 */
function levelPhoto(name: string, image: Img['image']): Img['image'] {
  return image === '/assets/court-primaria.webp' && /preescolar/i.test(name) ? '/assets/hopscotch.webp' : image;
}

function HomeLevelsView(p: LevelsProps) {
  const t = useTokens();
  const altOf = useMediaAlt();
  const cta = asLink(p.cta);
  return (
    <Section bg="cream">
      <m.div variants={sectionReveal} initial="hidden" whileInView="show" viewport={VIEWPORT} className="mb-10 text-center">
        {p.eyebrow && <span className="section-label-green inline-flex">{t(p.eyebrow)}</span>}
        <h2 className="font-head font-extrabold text-fluid-4xl tracking-[-0.03em] text-ink">{t(p.title)}</h2>
        {p.text && <p className="mx-auto mt-3 max-w-lg text-base leading-relaxed text-muted">{t(p.text)}</p>}
      </m.div>
      <m.div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" variants={staggerGroup} initial="hidden" whileInView="show" viewport={VIEWPORT}>
        {asList<LevelItem>(p.items).map((l, i) => {
          const accent = cmsColor(l.color);
          const name = t(l.name);
          const image = levelPhoto(name, l.image);
          return (
            <m.div key={i} variants={sectionReveal} className="h-full">
              <div className="hover-lift flex h-full flex-col overflow-hidden rounded-md bg-white shadow-card">
                <div className="relative aspect-[16/10] overflow-hidden bg-cream-2">
                  {image && <img src={imageSrc(image, 'md')} srcSet={imageSrcSet(image)} sizes={CARD_SIZES} alt={altOf(image, name)} loading="lazy" decoding="async" width={400} height={250} className="absolute inset-0 h-full w-full max-w-full object-cover" onError={hideOnError} />}
                  {/* A dark veil keeps the white name legible on every photo (the yellow of secundaria included); the level colour is the rule above it and the edge below. */}
                  <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-dark/75 via-dark/10 to-transparent" />
                  <div className="absolute inset-x-5 bottom-4">
                    <span aria-hidden="true" className="mb-2 block h-1 w-10 rounded-full" style={{ background: accent }} />
                    <h3 className="font-head text-[24px] font-extrabold leading-none text-white">{name}</h3>
                  </div>
                </div>
                <div className="flex flex-1 flex-col px-5 pb-5 pt-4" style={{ borderTop: `4px solid ${accent}` }}>
                  {l.text && <p className="flex-1 text-base leading-relaxed text-muted">{t(l.text)}</p>}
                  <CmsAnchor link={{ href: l.href }} className="mt-4 inline-flex items-center gap-1.5 self-start rounded-sm text-[15px] font-bold text-ink focus-visible:ring-2 focus-visible:ring-offset-2">{t(l.linkLabel) || `Conocer ${name}`} <ArrowRight size={16} style={{ color: accent }} /></CmsAnchor>
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
              <div className="relative mx-auto aspect-square w-full max-w-[176px]">
                <div className="absolute inset-0 rounded-full" style={{ background: `color-mix(in srgb, ${accent} 8%, transparent)` }} />
                <div className="absolute inset-2.5 overflow-hidden rounded-full" style={{ border: `3px solid ${accent}`, boxShadow: `0 16px 30px -14px color-mix(in srgb, ${accent} 53%, transparent)` }}>
                  {it.image && <img src={imageSrc(it.image, 'md')} srcSet={imageSrcSet(it.image)} sizes="(min-width: 1024px) 176px, 45vw" alt={altOf(it.image, it.name)} loading="lazy" decoding="async" width={176} height={176} className="h-full w-full max-w-full object-cover" onError={hideOnError} />}
                </div>
                <div className="absolute bottom-0.5 right-0.5 flex h-10 w-10 items-center justify-center rounded-sm shadow-[0_8px_18px_-6px_rgba(0,0,0,0.4)]" style={{ background: accent }}>
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
          <p className="text-base text-muted">{t(p.footnote)}</p>
        </m.div>
      )}
    </Section>
  );
}

/* ── Promociones (par de tarjetas de color) ─────────────────────────────── */
interface PromoItem { label?: string; title?: string; text?: string; link?: CmsLink; color?: string; color2?: string; icon?: string; illustration?: string }
function HomePromosView({ items }: { items?: PromoItem[] }) {
  const t = useTokens();
  return (
    <Section bg="cream">
      <m.div className="grid grid-cols-1 gap-6 lg:grid-cols-2" variants={staggerGroup} initial="hidden" whileInView="show" viewport={VIEWPORT}>
        {asList<PromoItem>(items).map((it, i) => {
          const Icon = cmsIcon(it.icon);
          const link = asLink(it.link);
          const title = t(it.title);
          const art = cardArt(it.illustration, it.icon, title, PROMO_ART);
          return (
            <m.div key={i} variants={i % 2 === 0 ? fadeRight : fadeLeft} className="h-full">
              <div className="hover-lift relative grid h-full min-h-[260px] content-start items-start gap-5 overflow-hidden rounded-md px-7 py-9 text-white shadow-[0_24px_48px_-20px_rgba(16,12,40,0.4)] sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6 sm:px-9 sm:py-10" style={{ background: `linear-gradient(135deg, ${cmsColor(it.color)} 0%, ${cmsColor(it.color2, cmsColor(it.color))} 100%)` }}>
                {art ? (
                  // The art sits on a soft white disc so it reads on any card colour; first on phones, beside the text from sm.
                  <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-white/[0.14] sm:order-2 sm:h-36 sm:w-36 sm:self-center xl:h-40 xl:w-40">
                    <Illustration name={art} size={150} fluid className="w-[90%]" />
                  </div>
                ) : (
                  <div className="pointer-events-none absolute -top-12 -right-12 h-[200px] w-[200px] rounded-full bg-white/[0.08]" />
                )}
                <div className="relative sm:order-1">
                  {!art && <Icon size={40} color="rgba(255,255,255,0.9)" className="mb-5" />}
                  {it.label && <span className="text-xs font-bold uppercase tracking-[1.5px] opacity-85">{t(it.label)}</span>}
                  <h3 className="mt-2 font-head text-[26px] font-extrabold leading-tight tracking-[-0.02em]">{title}</h3>
                  {it.text && <p className="mt-3 max-w-[420px] text-base leading-relaxed opacity-90">{t(it.text)}</p>}
                  <CmsAnchor link={link} className="mt-5 inline-flex items-center gap-1.5 rounded-sm text-[15px] font-bold text-white underline decoration-2 decoration-white/50 underline-offset-4 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2">{link.label} <ArrowRight size={16} aria-hidden="true" /></CmsAnchor>
                </div>
              </div>
            </m.div>
          );
        })}
      </m.div>
    </Section>
  );
}

/* ── Por qué Interlaken: illustrated cards (the level pages' program cards) ── */
interface StrengthItem { icon?: string; color?: string; title?: string; text?: string; illustration?: string }
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
          const title = t(s.title);
          const art = cardArt(s.illustration, s.icon, title);
          return (
            <m.div key={i} variants={sectionReveal} className="h-full">
              {/* Phones: the art in a tile beside the text; from sm a header band above it. */}
              <div className="flex h-full items-start gap-4 rounded-md bg-white p-5 shadow-card sm:flex-col sm:items-stretch sm:gap-0 sm:overflow-hidden sm:p-0">
                {art ? (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md sm:h-auto sm:w-auto sm:rounded-none sm:py-6" style={{ background: wash(color, 12) }}>
                    <Illustration name={art} size={136} fluid className="w-[84%] sm:w-[136px]" />
                  </div>
                ) : (
                  <div className="sm:px-6 sm:pt-6">
                    <div className="flex h-[52px] w-[52px] items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
                      <Icon size={26} color={color} />
                    </div>
                  </div>
                )}
                <div className="flex-1 sm:p-6">
                  <h3 className="font-head text-[19px] font-bold text-ink">{title}</h3>
                  {s.text && <p className="mt-2 text-base leading-relaxed text-muted">{t(s.text)}</p>}
                </div>
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
          <Link key={i} to={href} aria-label="Ver la galería completa" className="group block overflow-hidden rounded-md border border-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
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
interface LeadProps {
  title?: string; text?: string; button?: string; success?: string; subject?: string;
  nameLabel?: string; emailLabel?: string; sending?: string; sentToast?: string; errorToast?: string;
  message?: string; privacyText?: string; privacyLink?: string;
}
function LeadForm(p: LeadProps) {
  const t = useTokens();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  // The browser's own check (required, type=email) stops the submit and
  // focuses the first empty field; a server failure shows above the button.
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setFailed(false);
    try {
      await contactApi.send({
        name: name.trim(),
        email: email.trim(),
        subject: p.subject || 'Solicitud de informes',
        message: fill(t(p.message) || '{nombre} solicita informes desde la página de inicio.', { nombre: name.trim() }),
      });
      setDone(true);
      toast.success(t(p.sentToast) || '¡Gracias! Le contactaremos muy pronto.');
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-md bg-gradient-to-br from-purple to-brand-500 text-white px-6 py-10 text-center sm:px-10 sm:py-12 lg:py-14">
      <div className="pointer-events-none absolute -top-16 -right-10 hidden h-56 w-56 rounded-full bg-white/[0.06] sm:block" />
      <div className="relative mx-auto max-w-[620px]">
        <div className="mx-auto mb-4 inline-flex h-[52px] w-[52px] items-center justify-center rounded-sm bg-white/[0.14]">
          <Mail size={24} aria-hidden="true" />
        </div>
        <h2 className="font-head font-extrabold text-fluid-3xl tracking-tight">{t(p.title)}</h2>
        {p.text && <p className="mt-2.5 text-base leading-relaxed opacity-90">{t(p.text)}</p>}
        {done ? (
          <div role="status" className="mt-6 inline-flex items-center gap-2 rounded-md bg-white/[0.14] px-5 py-3 font-semibold">
            <Check size={20} color="var(--green-mid)" strokeWidth={3} aria-hidden="true" /> {t(p.success) || '¡Solicitud recibida! Le contactaremos pronto.'}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 flex flex-col flex-wrap justify-center gap-3 text-left sm:mt-6 sm:flex-row sm:items-end">
            {/* Visible labels, not placeholders: the placeholder vanishes on the
                first keystroke, leaving the field unidentified on review and for
                voice control. */}
            <label className="min-w-0 flex-1 sm:flex-[1_1_180px]">
              <span className="mb-1.5 block text-sm font-medium text-white/90">{t(p.nameLabel)}</span>
              <input
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-describedby={failed ? 'home-lead-error' : undefined}
                className="w-full rounded-sm border-none px-5 py-3.5 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-pink focus-visible:ring-offset-2 focus-visible:ring-offset-purple"
              />
            </label>
            <label className="min-w-0 flex-1 sm:flex-[1_1_220px]">
              <span className="mb-1.5 block text-sm font-medium text-white/90">{t(p.emailLabel)}</span>
              <input
                type="email" inputMode="email" autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-describedby={failed ? 'home-lead-error' : undefined}
                className="w-full rounded-sm border-none px-5 py-3.5 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-pink focus-visible:ring-offset-2 focus-visible:ring-offset-purple"
              />
            </label>
            {failed ? (
              <p id="home-lead-error" role="alert" className="flex w-full basis-full items-start gap-2 rounded-sm bg-white px-3 py-2.5 text-sm font-semibold text-danger">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{t(p.errorToast) || 'No fue posible enviar su solicitud. Intente de nuevo.'}</span>
              </p>
            ) : null}
            <button
              type="submit"
              className="btn btn-lg shrink-0 justify-center bg-pink text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-purple disabled:opacity-70"
              disabled={sending}
            >
              {sending ? t(p.sending) || 'Enviando…' : <>{t(p.button) || 'Solicitar'} <Send size={16} aria-hidden="true" /></>}
            </button>
          </form>
        )}
        {!done && (
          // LFPDPPP notice at the point of collection (editable wording; the link always goes to the notice).
          <p className="mx-auto mt-4 flex max-w-[520px] items-start justify-center gap-2 text-xs leading-relaxed text-white/80">
            <ShieldCheck size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>
              {t(p.privacyText)}{' '}
              <Link to="/aviso-de-privacidad" className="font-semibold text-white underline underline-offset-2">
                {t(p.privacyLink)}
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
