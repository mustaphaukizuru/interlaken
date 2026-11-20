/**
 * Generic «Tabla» block (docs/cms/price-tables.md): a real <table> with a
 * caption and scoped headers, figures formatted per column, an optional
 * highlighted row and footnotes, and an optional card identical to the price
 * cards of /admisiones/costos. Part of the generic-blocks chunk, so a page
 * downloads it only when it uses the block. Everything renders as React
 * text (no HTML from the draft reaches the page).
 */
import { CircleDollarSign } from 'lucide-react';
import { PriceCard } from '@/components/public/PricingSections';
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

/** The table itself; scrolls sideways inside its box on a narrow phone, never the page. */
export function DataTableView({ value, caption }: { value: TableValue; caption: string }) {
  const t = useTokens();
  const { columns, rows, highlight } = value;
  if (columns.length === 0) return null;
  return (
    // Focusable so a keyboard can scroll a wide table sideways on a phone (WCAG 2.1.1).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="overflow-x-auto" role="region" aria-label={caption} tabIndex={0}>
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
              <tr key={r} className={`border-b border-ink/5 last:border-0 ${bg} ${strong ? 'font-bold' : ''}`}>
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
    <section className={`${p.bg === 'white' ? 'bg-white' : 'bg-cream-2'} py-10 sm:py-14`}>
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
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
            <div className={`${title || intro ? 'mt-5' : ''} overflow-hidden rounded-xl2 border border-ink/10 bg-white shadow-card`}>{body}</div>
            <Notes notes={notes} boxed={false} />
          </div>
        )}
      </div>
    </section>
  );
}

export default TableBlock;
