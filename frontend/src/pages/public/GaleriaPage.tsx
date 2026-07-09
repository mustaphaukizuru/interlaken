import { Seo } from '@/components/seo/Seo';

const PHOTOS = [
  ...Array.from({ length: 19 }, (_, i) => `/assets/interlaken-image (${i + 1}).webp`),
  '/assets/campus-court.webp',
  '/assets/campus-mural.webp',
  '/assets/classroom.webp',
  '/assets/facade.webp',
];

/** Galería de vida escolar — fotos reales del campus y sus actividades. */
export default function GaleriaPage() {
  return (
    <div>
      <Seo
        title="Galería"
        description="La vida en el Colegio Interlaken: campus, salones, deportes y actividades de Preescolar, Primaria y Secundaria en Tlalnepantla."
      />

      <section className="bg-dark text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
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
          <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>img]:mb-3">
            {PHOTOS.map((src, i) => (
              <img
                key={src}
                src={src}
                alt={`Vida escolar en el Colegio Interlaken — fotografía ${i + 1}`}
                loading={i < 4 ? 'eager' : 'lazy'}
                width={480}
                height={360}
                className="w-full break-inside-avoid rounded-xl2 border border-ink/5 object-cover"
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
