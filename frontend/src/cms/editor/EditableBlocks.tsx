/**
 * The editor's live preview (AdminPageEditor): every block outlined and
 * selectable by click or keyboard, links and forms inert, hidden blocks
 * dimmed with a label. Renders each block with the public BlockView, so the
 * preview is the page as published.
 */
import { Suspense, type KeyboardEvent, type MouseEvent } from 'react';
import { EyeOff } from 'lucide-react';
import { BlockView } from '../BlockRenderer';
import { blockSpec, type Block } from '../blocks/registry';

export function EditableBlocks({ blocks, selectedId, onSelect }: { blocks: Block[]; selectedId?: string | null; onSelect?: (id: string) => void }) {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" aria-busy="true" />}>
      {blocks.map((b) => {
        const select = (e: MouseEvent | KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); onSelect?.(b.id); };
        const label = blockSpec(b.type)?.label ?? b.type;
        return (
          <div
            key={b.id}
            data-block-id={b.id}
            data-block-type={b.type}
            role="button"
            tabIndex={0}
            aria-label={`Editar bloque: ${label}`}
            aria-pressed={selectedId === b.id}
            // Capture phase: a Link or a submit button inside the section must not act in the preview.
            onClickCapture={select}
            onKeyDownCapture={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) select(e); }}
            onSubmitCapture={(e) => e.preventDefault()}
            className={`relative cursor-pointer outline-offset-[-2px] hover:outline hover:outline-2 hover:outline-purple/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple ${selectedId === b.id ? 'outline outline-2 outline-purple' : ''} ${b.hidden ? 'opacity-40' : ''}`}
          >
            <span className="pointer-events-none absolute left-2 top-2 z-30 inline-flex items-center gap-1 rounded bg-purple px-2 py-0.5 text-[10px] font-bold text-white">
              {b.hidden && <EyeOff size={10} aria-hidden="true" />}{label}{b.hidden ? ' · oculto' : ''}
            </span>
            <BlockView block={b} />
          </div>
        );
      })}
    </Suspense>
  );
}

export default EditableBlocks;
