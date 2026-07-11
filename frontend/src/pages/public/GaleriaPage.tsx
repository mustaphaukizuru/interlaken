import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';

type Category = 'instalaciones' | 'vida';

interface Photo {
  src: string;
  cat: Category;
}

const PHOTOS: Photo[] = [
  ...Array.from({ length: 19 }, (_, i): Photo => ({
    src: `/assets/interlaken-image (${i + 1}).webp`,
    cat: 'vida',
  })),
  { src: '/assets/campus-court.webp', cat: 'instalaciones' },
  { src: '/assets/campus-mural.webp', cat: 'instalaciones' },
  { src: '/assets/classroom.webp', cat: 'instalaciones' },
  { src: '/assets/facade.webp', cat: 'instalaciones' },
];

const FILTERS: { key: Category | 'todas'; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'vida', label: 'Vida escolar' },
  { key: 'instalaciones', label: 'Instalaciones' },
];

/** Lightbox accesible y sin dependencias: Esc cierra, ←/→ navegan. */
function Lightbox({
  photos, index, onClose, onMove,
}: {
  photos: Photo[]; index: number; onClose: () => void; onMove: (next: number) => void;
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
      aria-label={`Fotografía ${index + 1} de ${photos.length}`}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-dark/95 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Cerrar galería"
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); prev(); }}
        aria-label="Fotografía anterior"
        className="absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green sm:left-4"
      >
        <ChevronLeft className="h-6 w-6" aria-hidden="true" />
      </button>

      <figure className="max-h-full">
        <img
          src={photos[index].src}
          alt={`Vida escolar en el Colegio Interlaken — fotografía ${index + 1}`}
          className="max-h-[82vh] w-auto max-w-full rounded-xl2 object-contain"
        />
        <figcaption className="mt-3 text-center text-sm text-white/70">
          {index + 1} / {photos.length}
        </figcaption>
      </figure>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); next(); }}
        aria-label="Fotografía siguiente"
        className="absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green sm:right-4"
      >
        <ChevronRight className="h-6 w-6" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Galería de vida escolar — filtros por categoría + lightbox con teclado. */
export default function GaleriaPage() {
  const [filter, setFilter] = useState<Category | 'todas'>('todas');
  const [open, setOpen] = useState<number | null>(null);

  const visible = filter === 'todas' ? PHOTOS : PHOTOS.filter((p) => p.cat === filter);

  return (
    <div>
      <Seo
        title="Galería"
        description="La vida en el Colegio Interlaken: campus, salones, deportes y actividades de Preescolar, Primaria y Secundaria en Tlalnepantla."
      />

      <section className="relative overflow-hidden bg-dark text-white">
        <img src="/assets/hopscotch.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <span className="section-label-pink inline-flex">El Colegio</span>
          <h1 className="mt-3 font-head text-fluid-3xl font-black tracking-[-0.02em]">
            Galería
          </h1>
          <p className="mt-3 max-w-2xl text-[15.5px] text-white/80">
            Así se vive un día en Interlaken: instalaciones, aprendizaje y
            comunidad.
          </p>
        </div>
      </section>

      <section className="bg-white py-10 sm:py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* Filtros por categoría */}
          <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filtrar fotografías">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => { setFilter(f.key); setOpen(null); }}
                className={`min-h-[44px] rounded-full border-2 px-5 text-sm font-semibold transition-colors ${
                  filter === f.key
                    ? 'border-green bg-green text-white'
                    : 'border-ink/15 text-muted hover:border-green hover:text-green-dark'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Grid — cada foto abre el lightbox */}
          <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
            {visible.map((photo, i) => (
              <button
                key={photo.src}
                type="button"
                onClick={() => setOpen(i)}
                aria-label={`Ampliar fotografía ${i + 1} de ${visible.length}`}
                className="group mb-3 block w-full break-inside-avoid overflow-hidden rounded-xl2 border border-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green"
              >
                <img
                  src={photo.src}
                  alt={`Vida escolar en el Colegio Interlaken — fotografía ${i + 1}`}
                  loading={i < 4 ? 'eager' : 'lazy'}
                  width={480}
                  height={360}
                  className="w-full object-cover transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  onError={(e) => (((e.target as HTMLImageElement).closest('button') as HTMLButtonElement).style.display = 'none')}
                />
              </button>
            ))}
          </div>
        </div>
      </section>

      {open !== null && (
        <Lightbox
          photos={visible}
          index={open}
          onClose={() => setOpen(null)}
          onMove={setOpen}
        />
      )}
    </div>
  );
}
