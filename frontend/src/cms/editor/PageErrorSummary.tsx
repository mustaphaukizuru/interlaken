/**
 * «Antes de publicar» summary of the CMS editor (contract C3): every field of
 * the page that would block publishing, found while editing (required fields,
 * images without description or deleted, links that cannot work) plus the
 * server's structured errors. Each line jumps to its field and focuses it.
 */
import { useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { blockSpec, withDefaults, type Block } from '../blocks/registry';
import { useMediaLookup } from './fields/media';
import { imageIdsIn, LABEL_SEP, validateFields, type CmsFieldError } from './validation';

export interface SummaryLine { blockId: string; blockIndex: number; blockLabel: string; field: string; fieldLabel: string; message: string }

/** Client problems of the visible blocks, then server errors not already listed (same block and field). */
export function summaryLines(blocks: Block[], serverErrors: CmsFieldError[], media?: Parameters<typeof validateFields>[2]): SummaryLine[] {
  const lines: SummaryLine[] = [];
  blocks.forEach((b, i) => {
    if (b.hidden) return;
    const spec = blockSpec(b.type);
    if (!spec) return;
    for (const issue of validateFields(spec.fields, withDefaults(spec, b.props), media)) {
      lines.push({ blockId: b.id, blockIndex: i, blockLabel: spec.label, field: issue.path, fieldLabel: issue.label, message: issue.message });
    }
  });
  for (const e of serverErrors) {
    if (!e.block_id || lines.some((l) => l.blockId === e.block_id && l.field === e.field)) continue;
    const i = blocks.findIndex((b) => b.id === e.block_id);
    if (i < 0) continue;
    lines.push({ blockId: e.block_id, blockIndex: i, blockLabel: e.block_label || blockSpec(blocks[i].type)?.label || '', field: e.field, fieldLabel: e.field_label || '', message: e.message });
  }
  return lines.sort((a, b) => a.blockIndex - b.blockIndex);
}

const SHOWN = 6;

export function PageErrorSummary({ blocks, serverErrors = [], onJump }: { blocks: Block[]; serverErrors?: CmsFieldError[]; onJump: (blockId: string, field: string) => void }) {
  const ids = blocks.flatMap((b) => {
    const spec = blockSpec(b.type);
    return spec && !b.hidden ? imageIdsIn(spec.fields, withDefaults(spec, b.props)) : [];
  });
  const media = useMediaLookup(ids);
  const lines = summaryLines(blocks, serverErrors, media);
  const [all, setAll] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  if (lines.length === 0) return null;
  const shown = all ? lines : lines.slice(0, SHOWN);
  const n = lines.length;
  return (
    <section className="mb-4 rounded-xl border border-coral-200 bg-coral-50/60 p-3" aria-labelledby="cms-error-summary-title">
      <div className="flex items-center gap-2">
        <AlertTriangle size={18} className="shrink-0 text-coral-600" aria-hidden="true" />
        <h2 id="cms-error-summary-title" className="flex-1 text-sm font-bold text-ink" aria-live="polite">
          Antes de publicar, corrija {n} {n === 1 ? 'campo' : 'campos'}
        </h2>
        <button type="button" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-controls="cms-error-summary-list" className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-subtle hover:text-ink sm:min-h-[32px]">
          {collapsed ? 'Ver' : 'Ocultar'} <ChevronDown size={14} className={collapsed ? '-rotate-90' : ''} aria-hidden="true" />
        </button>
      </div>
      <div id="cms-error-summary-list" hidden={collapsed}>
        <ul className="mt-2 space-y-1">
          {shown.map((l) => (
            <li key={`${l.blockId}:${l.field}`}>
              <button
                type="button"
                onClick={() => onJump(l.blockId, l.field)}
                className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple"
              >
                <span className="font-semibold text-ink">{l.blockIndex + 1}. {l.blockLabel}</span>
                {l.fieldLabel && <span className="text-ink">{LABEL_SEP}{l.fieldLabel}</span>}
                <span className="block text-xs text-coral-700">{l.message}</span>
              </button>
            </li>
          ))}
        </ul>
        {n > SHOWN && (
          <button type="button" onClick={() => setAll((a) => !a)} className="mt-1 min-h-[44px] px-2 text-xs font-semibold text-purple hover:underline sm:min-h-[32px]">
            {all ? 'Ver menos' : `Ver los ${n}`}
          </button>
        )}
      </div>
    </section>
  );
}
