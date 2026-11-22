/**
 * Generic «Tabla» block (docs/cms/price-tables.md): a real <table> with a
 * caption and scoped headers, figures formatted per column, an optional
 * highlighted row and footnotes, and an optional card identical to the price
 * cards of /admisiones/costos. Part of the generic-blocks chunk, so a page
 * downloads it only when it uses the block. Everything renders as React
 * text (no HTML from the draft reaches the page).
 */
import { useEffect, useRef, useState } from 'react';
import { CircleDollarSign } from 'lucide-react';
import { PriceCard } from '@/components/public/PricingSections';
import { Section } from '@/components/ui/Section';
import { iconResolver } from '../iconRuntime';
import { useTokens } from '../runtime';
import { alignOf, formatCell, normalizeTable, type TableValue } from './table';

const cardIcon = iconResolver({ CircleDollarSign });
const TONES = ['green', 'coral', 'purple', 'pink'] as const;
type Tone = (typeof TONES)[number];
const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

export interface TableBlockProps {
  title?: string; intro?: string; table?: unknown; notes?: string;
  card?: boolean; tone?: string; icon?: string; label?: string; subtitle?: string; bg?: string;
}

/** True while the box is narrower than the table inside it (a phone with many columns). */
function useScrollsSideways() {
  const ref = useRef<HTMLDivElement>(null);
  const [sideways, setSideways] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const check = () => setSideways(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return [ref, sideways] as const;
}

/** The table itself; scrolls sideways inside its box on a narrow phone, never the page. */
export function DataTableView({ value, caption }: { value: TableValue; caption: string }) {
  const t = useTokens();
  const [box, sideways] = useScrollsSideways();
  const { columns, rows, highlight } = value;
  if (columns.length === 0) return null;
  return (
    <>
    {/* While it scrolls, a keyboard can reach it to scroll (WCAG 2.1.1) and it is named. */}
    <div ref={box} className="overflow-x-auto" {...(sideways ? { role: 'region', 'aria-label': caption, tabIndex: 0 } : {})}>
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-ink/5 text-[11px] text-muted sm:text-xs sm:uppercase sm:tracking-wide">
            {columns.map((c, i) => (
              <th key={i} scope="col" className={`px-3 py-2.5 font-semibold sm:px-5 ${ALIGN[alignOf(c)]}`}>{t(c.label)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => {
            const strong = r === highlight;
            const bg = strong ? 'bg-green-50' : 'bg-white';
            return (
              <tr key={r} className={`border-b border-ink/5 last:border-0 ${strong ? `${bg} font-bold` : ''}`}>
                {cells.map((cell, i) => {
                  const col = columns[i];
                  const text = formatCell(t(cell), col.format);
                  const figure = col.format && col.format !== 'text';
                  const cls = `px-3 py-3.5 text-ink sm:px-5 ${ALIGN[alignOf(col)]} ${figure ? 'whitespace-nowrap' : 'min-w-[7rem]'}`;
                  return i === 0
                    ? <th key={i} scope="row" className={`sticky left-0 ${bg} ${cls} ${strong ? '' : 'font-normal'}`}>{text}</th>
                    : <td key={i} className={cls}>{text}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {sideways && <p className="px-5 py-2 text-right text-xs text-muted" aria-hidden="true">Deslice la tabla para ver todas las columnas →</p>}
    </>
  );
}

function Notes({ notes, boxed }: { notes: string[]; boxed: boolean }) {
  if (notes.length === 0) return null;
  return (
    <ul className={`space-y-1 text-xs leading-relaxed text-muted ${boxed ? 'border-t border-ink/5 px-5 py-3' : 'mt-3'}`}>
      {notes.map((n, i) => <li key={i}>{n}</li>)}
    </ul>
  );
}

export function TableBlock(p: TableBlockProps) {
  const t = useTokens();
  const value = normalizeTable(p.table);
  const title = t(p.title).trim();
  const caption = title || t(p.label).trim() || 'Tabla';
  const intro = t(p.intro).trim();
  const notes = t(p.notes).split('\n').map((n) => n.trim()).filter(Boolean);
  const tone: Tone = TONES.includes(p.tone as Tone) ? (p.tone as Tone) : 'green';
  const body = <DataTableView value={value} caption={caption} />;
  return (
    // The width and rhythm of the other generic blocks and the designed sections (Section, container lg).
    <Section bg={p.bg === 'white' ? 'white' : 'cream'}>
      <div>
        {p.card !== false ? (
          <PriceCard tone={tone} icon={cardIcon(p.icon, CircleDollarSign)} label={t(p.label)} title={title} subtitle={t(p.subtitle) || undefined}>
            {intro && <p className="border-b border-ink/5 px-5 py-3 text-sm text-muted">{intro}</p>}
            {body}
            <Notes notes={notes} boxed />
          </PriceCard>
        ) : (
          <div>
            {title && <h2 className="font-head text-fluid-2xl font-extrabold tracking-tight text-ink">{title}</h2>}
            {intro && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{intro}</p>}
            <div className={`${title || intro ? 'mt-5' : ''} overflow-hidden rounded-md border border-ink/10 bg-white shadow-card`}>{body}</div>
            <Notes notes={notes} boxed={false} />
          </div>
        )}
      </div>
    </Section>
  );
}

export default TableBlock;
