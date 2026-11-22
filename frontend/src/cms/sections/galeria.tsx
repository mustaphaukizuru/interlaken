/**
 * Galería (/galeria): designed sections (docs/CMS-COMPLETION-PLAN.md). The
 * hero, and the filterable photo grid with its keyboard lightbox; photos and
 * filter categories are editable lists.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, Maximize2 } from 'lucide-react';
import { imageSrc, imageSrcSet, useMediaAlt, useTokens } from '../runtime';
import { asList, defineModule, f, fill, grouped, Lines, sectionsOf } from './kit';

const section = sectionsOf('galeria');

/** The filter key that shows every photo. */
const ALL = 'todas';

interface Photo {
  /** Short description shown on the card and in the lightbox (BACKLOG P2-10). */
  caption: string;
  src: string;
  alt: string;
  cat: string;
  /** Position in the full list: a stable key across filters. */
  id: number;
}

const altFor = (cat: string) =>
  cat === 'vida'
    ? 'Vida escolar en el Colegio Interlaken'
    : 'Instalaciones del Colegio Interlaken';

/* ── Portada ────────────────────────────────────────────────────────────── */
function GaleriaHeroView(p: { label?: string; title?: string; subtitle?: string; image?: number | string }) {
  const t = useTokens();
  return (
    <section className="relative overflow-hidden bg-dark text-white">
      {p.image && <img src={imageSrc(p.image)} srcSet={imageSrcSet(p.image, { full: true })} sizes="100vw" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />}
      <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
      <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        {p.label && <span className="section-label-pink inline-flex">{t(p.label)}</span>}
        <h1 className="mt-3 font-head text-fluid-3xl font-black tracking-[-0.02em]">
          <Lines text={t(p.title)} />
        </h1>
        {p.subtitle && (
          <p className="mt-3 max-w-2xl text-[15.5px] text-white/80">
            {t(p.subtitle)}
          </p>
        )}
      </div>
    </section>
  );
}

/* ── Lightbox ───────────────────────────────────────────────────────────── */

/** Words of the grid and the lightbox (editable in Contenido; {n} and {total} are filled in). */
interface GridCopy { countOne: string; countMany: string; zoomLabel: string; zoomAria: string; dialogLabel: string; closeLabel: string; prevLabel: string; nextLabel: string; position: string }

/** Lightbox accesible y sin dependencias: Esc cierra, ←/→ navegan. */
function Lightbox({
  photos, index, onClose, onMove, copy,
}: {
  photos: Photo[]; index: number; onClose: () => void; onMove: (next: number) => void; copy: GridCopy;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  const prev = useCallback(
    () => onMove((index - 1 + photos.length) % photos.length),
    [index, photos.length, onMove],
  );
  const next = useCallback(
    () => onMove((index + 1) % photos.length),
    [index, photos.length, onMove],
  );

  useEffect(() => {
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, prev, next]);

  return (
    // Backdrop click-to-dismiss (only on the backdrop itself, not its children)
    // is a supplementary pointer affordance; keyboard users close via Escape or
    // arrows (window keydown handler above) and the visible close button.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <div
      role="dialog"
      aria-modal="true"
      aria-label={fill(copy.dialogLabel, { n: index + 1, total: photos.length })}
      className="fixed inset-0 z-overlay flex items-center justify-center bg-dark/95 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label={copy.closeLabel}
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-sm bg-white/10 text-white hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); prev(); }}
        aria-label={copy.prevLabel}
        className="absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-sm bg-white/10 text-white hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green sm:left-4"
      >
        <ChevronLeft className="h-6 w-6" aria-hidden="true" />
      </button>

      <figure className="w-full max-w-4xl">
        {/* Lienzo de tamaño estable: la foto se acomoda (object-contain) dentro
            de una caja fija, así el lightbox no re-fluye (botones/caption no
            saltan) mientras cada imagen se decodifica al navegar. */}
        <div className="flex h-[82vh] items-center justify-center">
          <img
            src={photos[index].src}
            alt={photos[index].alt}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        </div>
        <figcaption className="mt-3 text-center text-sm text-white/70">
          {photos[index].caption && <span className="block text-base font-semibold text-white">{photos[index].caption}</span>}
          {fill(copy.position, { n: index + 1, total: photos.length })}
        </figcaption>
      </figure>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); next(); }}
        aria-label={copy.nextLabel}
        className="absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-sm bg-white/10 text-white hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green sm:right-4"
      >
        <ChevronRight className="h-6 w-6" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ── Fotos con filtros ──────────────────────────────────────────────────── */
interface PhotoItem { image?: number | string; caption?: string; category?: string }
interface FilterItem { key?: string; label?: string }

/** Galería de vida escolar: filtros por categoría + lightbox con teclado. */
type GridProps = { photos?: PhotoItem[]; filters?: FilterItem[]; filterLabel?: string } & Partial<GridCopy>;
function GaleriaGridView(p: GridProps) {
  const t = useTokens();
  const copy: GridCopy = {
    countOne: t(p.countOne), countMany: t(p.countMany), zoomLabel: t(p.zoomLabel), zoomAria: t(p.zoomAria),
    dialogLabel: t(p.dialogLabel), closeLabel: t(p.closeLabel), prevLabel: t(p.prevLabel), nextLabel: t(p.nextLabel), position: t(p.position),
  };
  const altOf = useMediaAlt();
  const filters = asList<FilterItem>(p.filters).filter((x) => x?.key);
  const [filter, setFilter] = useState<string>(filters[0]?.key ?? ALL);
  const [open, setOpen] = useState<number | null>(null);

  const photos: Photo[] = asList<PhotoItem>(p.photos)
    .filter((x) => x?.image)
    .map((x, id) => {
      const caption = t(x.caption);
      const cat = (x.category ?? '').trim();
      // Grid and lightbox use the full-size file (library images: the large variant).
      return { id, src: imageSrc(x.image), caption, cat, alt: caption || altOf(x.image, altFor(cat)) };
    });
  // A filter the editor just removed falls back to the first one.
  const active = filters.some((x) => x.key === filter) ? filter : (filters[0]?.key ?? ALL);
  const visible = active === ALL ? photos : photos.filter((x) => x.cat === active);

  return (
    <>
      <section className="bg-white py-10 sm:py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* Filtros por categoría */}
          {filters.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label={t(p.filterLabel)}>
              {filters.map((fl) => (
                <button
                  key={fl.key}
                  type="button"
                  aria-pressed={active === fl.key}
                  onClick={() => { setFilter(fl.key!); setOpen(null); }}
                  className={`min-h-[44px] rounded-sm border-2 px-5 text-sm font-semibold transition-colors ${
                    active === fl.key
                      ? 'border-green-strong bg-green-strong text-white'
                      : 'border-ink/15 text-muted hover:border-green hover:text-green-dark'
                  }`}
                >
                  {t(fl.label)}
                </button>
              ))}
            </div>
          )}

          <p className="mb-5 text-[13px] font-medium text-subtle">
            {visible.length} {visible.length === 1 ? copy.countOne : copy.countMany}
          </p>

          {/* Masonry grid: cada foto abre el lightbox */}
          <div className="columns-2 gap-4 sm:columns-3 lg:columns-4">
            {visible.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => setOpen(i)}
                aria-label={fill(copy.zoomAria, { n: i + 1, total: visible.length })}
                className="group relative mb-4 block w-full break-inside-avoid overflow-hidden rounded-sm bg-cream shadow-card ring-1 ring-ink/5 transition-shadow duration-300 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green"
              >
                <img
                  src={photo.src}
                  alt={photo.alt}
                  loading={i < 6 ? 'eager' : 'lazy'}
                  width={480}
                  height={360}
                  className="w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  onError={(e) => (((e.target as HTMLImageElement).closest('button') as HTMLButtonElement).style.display = 'none')}
                />
                {/* Hover affordance: gradient wash + "Ampliar" pill */}
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/55 via-ink/0 to-ink/0 opacity-100 transition-opacity duration-300 lg:opacity-0 lg:group-hover:opacity-100" />
                <span aria-hidden="true" className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-[11.5px] font-bold text-ink opacity-100 shadow-sm transition-all duration-300 lg:translate-y-1.5 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100 motion-reduce:transition-none">
                  <Maximize2 className="h-3 w-3 text-green-dark" /> {copy.zoomLabel}
                </span>
                {photo.caption && (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/70 to-transparent px-3 pb-2.5 pt-8 text-left text-[12.5px] font-semibold text-white opacity-90 transition-opacity group-hover:opacity-0">
                    {photo.caption}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {open !== null && visible[open] && (
        <Lightbox
          photos={visible}
          index={open}
          onClose={() => setOpen(null)}
          onMove={setOpen}
          copy={copy}
        />
      )}
    </>
  );
}

// Real campus / school-life photos only, one entry per distinct image.
// The brand logos that were mixed into this set (vertical & horizontal
// wordmarks, the 40-años mark and the bare isotipo) are not photography and
// were removed. Several photos also shipped twice under a generic
// "interlaken-image (n)" name and a descriptive one; the descriptive file is
// the single copy that remains, so the same shot cannot appear twice here.
const PHOTOS: PhotoItem[] = [
  { image: '/assets/interlaken-image (1).webp', category: 'instalaciones', caption: 'Entrada principal del campus' },
  { image: '/assets/interlaken-image (2).webp', category: 'instalaciones', caption: 'Pasillos y áreas comunes' },
  { image: '/assets/secundaria.webp', category: 'instalaciones', caption: 'Edificio de secundaria' },
  { image: '/assets/interlaken-image (4).webp', category: 'instalaciones', caption: 'Aulas con luz natural' },
  { image: '/assets/primaria-gate.webp', category: 'instalaciones', caption: 'Acceso de primaria' },
  { image: '/assets/court-logo.webp', category: 'vida', caption: 'Cancha techada con el escudo del colegio' },
  { image: '/assets/facade.webp', category: 'instalaciones', caption: 'Fachada del colegio' },
  { image: '/assets/hopscotch.webp', category: 'vida', caption: 'Juegos en el patio de preescolar' },
  { image: '/assets/campus-mural.webp', category: 'vida', caption: 'Mural de la comunidad Interlaken' },
  { image: '/assets/court-wide.webp', category: 'vida', caption: 'Canchas deportivas' },
  { image: '/assets/interlaken-image (15).webp', category: 'vida', caption: 'Actividades deportivas' },
  { image: '/assets/court-primaria.webp', category: 'vida', caption: 'Recreo en primaria' },
  { image: '/assets/facade-sign.webp', category: 'instalaciones', caption: 'Letrero de la fachada' },
  { image: '/assets/classroom.webp', category: 'instalaciones', caption: 'Salón de clases' },
];

export const sections = [
  section({
    type: 'hero', label: 'Galería · Portada', description: 'Foto del campus con velo oscuro, etiqueta, título y texto.',
    component: GaleriaHeroView,
    fields: [f.text('label', 'Etiqueta superior'), f.textarea('title', 'Título', { required: true }), f.textarea('subtitle', 'Texto'), f.image('image', 'Foto de fondo')],
    defaults: {
      label: 'El Colegio', title: 'Galería', image: '/assets/hopscotch.webp',
      subtitle: 'Así se vive un día en Interlaken: instalaciones, aprendizaje y comunidad.',
    },
  }),
  section({
    type: 'grid', label: 'Galería · Fotos con filtros', description: 'Fotos en mosaico con filtros por categoría; cada foto se amplía al hacer clic.',
    component: GaleriaGridView,
    fields: [
      f.items('photos', 'Fotos', [
        f.image('image', 'Foto', { required: true }),
        f.text('caption', 'Pie de foto'),
        f.select('category', 'Filtro', [], { optionsFrom: { list: 'filters', value: 'key', label: 'label' } }),
      ]),
      f.items('filters', 'Filtros', [
        f.text('label', 'Texto del botón', { required: true }),
        f.text('key', 'Clave', { required: true, advanced: true, slugFrom: { field: 'label', keep: ['todas'] } }),
      ]),
      ...grouped('Contador y foto ampliada', [
        f.text('countOne', 'Contador: una foto'),
        f.text('countMany', 'Contador: varias fotos'),
        f.text('zoomLabel', 'Etiqueta «Ampliar» sobre cada foto'),
        f.text('position', 'Posición bajo la foto ampliada'),
      ]),
      ...grouped('Lectores de pantalla (no se ven)', [
        f.text('filterLabel', 'Grupo de filtros'),
        f.text('zoomAria', 'Botón de cada foto'),
        f.text('dialogLabel', 'Foto ampliada'),
        f.text('closeLabel', 'Botón para cerrar'),
        f.text('prevLabel', 'Botón anterior'),
        f.text('nextLabel', 'Botón siguiente'),
      ]),
    ],
    defaults: {
      photos: PHOTOS,
      filters: [
        { key: 'todas', label: 'Todas' },
        { key: 'vida', label: 'Vida escolar' },
        { key: 'instalaciones', label: 'Instalaciones' },
      ],
      countOne: 'fotografía', countMany: 'fotografías', zoomLabel: 'Ampliar',
      filterLabel: 'Filtrar fotografías', zoomAria: 'Ampliar imagen {n} de {total}', dialogLabel: 'Fotografía {n} de {total}',
      closeLabel: 'Cerrar galería', prevLabel: 'Fotografía anterior', nextLabel: 'Fotografía siguiente', position: '{n} / {total}',
    },
  }),
];

export const templates = [{
  slug: 'galeria', path: '/galeria', title: 'Galería', group: 'galeria',
  seo: {}, // title and description: lib/routeMeta.ts ROUTE_META
  sections: ['galeria.hero', 'galeria.grid'],
}];

export default defineModule(sections, templates);
