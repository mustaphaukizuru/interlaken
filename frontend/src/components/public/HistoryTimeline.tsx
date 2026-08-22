import { Reveal } from '@/components/ui/Reveal';
import { FOUNDED_YEAR, SCHOOL_YEARS } from '@/lib/siteMeta';

/**
 * Milestones for "Quiénes Somos" (BACKLOG P2-8). Copy is a placeholder the
 * school can refine (and will move into the CMS `timeline` block, P3-5);
 * years are derived so the trail never goes stale.
 */
const MILESTONES: { year: number | string; title: string; desc: string }[] = [
  { year: FOUNDED_YEAR, title: 'Fundación', desc: 'Nace Colegio Interlaken en Tlalnepantla con preescolar y primaria, y una vocación bilingüe desde el primer día.' },
  { year: FOUNDED_YEAR + 9, title: 'Secundaria', desc: 'Se abre la secundaria incorporada a la SEP, completando la formación básica en un solo campus.' },
  { year: FOUNDED_YEAR + 25, title: 'Campus y deportes', desc: 'Ampliación de instalaciones deportivas y talleres: canchas, laboratorio y espacios de arte.' },
  { year: FOUNDED_YEAR + 38, title: 'Tecnología en el aula', desc: 'iPad de 4° a 6° de primaria, Google Classroom y plataformas para familias.' },
  { year: new Date().getFullYear(), title: `${SCHOOL_YEARS} años`, desc: 'Portal de Familias con cafetería digital, comunicados y admisiones en línea. La misma comunidad, nuevas herramientas.' },
];

export function HistoryTimeline() {
  return (
    <ol className="relative ml-3 border-l-2 border-purple/20 pl-6 sm:ml-4 sm:pl-8" aria-label="Línea de tiempo del colegio">
      {MILESTONES.map((m, i) => (
        <li key={String(m.year)} className="relative pb-8 last:pb-0">
          <span className="absolute -left-[33px] top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white ring-2 ring-purple sm:-left-[41px]" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-purple" />
          </span>
          <Reveal delay={i * 60}>
            <p className="font-head text-[12px] font-bold uppercase tracking-[1.4px] text-purple">{m.year}</p>
            <h3 className="mt-1 font-head text-[17px] font-bold text-ink">{m.title}</h3>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">{m.desc}</p>
          </Reveal>
        </li>
      ))}
    </ol>
  );
}

export default HistoryTimeline;
