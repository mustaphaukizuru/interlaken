import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Copy, CopyPlus, Eye, EyeOff, GripVertical, Lock, Trash2 } from 'lucide-react';
import { blockSpec, type Block } from '../../blocks/registry';
import { BlockIcon } from './blockIcons';
import { blockSummary, splitLabel } from './blockLabels';
import { MoreMenu, type MenuItem } from './MoreMenu';

interface Props {
  blocks: Block[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onToggleHidden: (b: Block) => void;
  onDelete: (b: Block) => void;
  onDuplicate: (b: Block) => void;
  onCopy: (b: Block) => void;
  /** Undo/redo, paste and «Agregar». */
  toolbar?: ReactNode;
}

/**
 * The page's sections: full names on up to two lines (tooltip with the whole
 * label), a section-type icon, the hidden state in words, drag to reorder and
 * Alt+↑/↓ on a focused section (also «Subir»/«Bajar» in its menu).
 */
export function BlockList({ blocks, selectedId, onSelect, onMove, onToggleHidden, onDelete, onDuplicate, onCopy, toolbar }: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');

  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    onMove(from, to);
    setAnnounce(`${splitLabel(blocks[from].type).name}: posición ${to + 1} de ${blocks.length}.`);
  };
  const onKey = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-head text-sm font-bold uppercase tracking-wide text-subtle">Secciones <span className="font-normal normal-case tracking-normal">({blocks.length})</span></h2>
        {toolbar}
      </div>
      <p className="sr-only" aria-live="polite">{announce}</p>
      {blocks.length === 0 ? <p className="text-sm text-muted">La página está vacía. Agregue la primera sección.</p> : (
        <ol className="space-y-1" aria-label="Secciones de la página" aria-describedby="block-list-help">
          {blocks.map((b, i) => {
            const spec = blockSpec(b.type);
            const locked = !!spec?.locked;
            const { name, page } = splitLabel(b.type);
            const summary = blockSummary(b);
            const selected = selectedId === b.id;
            const menu: MenuItem[] = [
              { key: 'up', label: 'Subir', icon: ArrowUp, onSelect: () => move(i, i - 1), disabled: i === 0 },
              { key: 'down', label: 'Bajar', icon: ArrowDown, onSelect: () => move(i, i + 1), disabled: i === blocks.length - 1 },
              ...(locked ? [] : [
                { key: 'dup', label: 'Duplicar', icon: CopyPlus, onSelect: () => onDuplicate(b) },
                { key: 'copy', label: 'Copiar para pegar en otra página', icon: Copy, onSelect: () => onCopy(b) },
                { key: 'del', label: 'Eliminar sección', icon: Trash2, onSelect: () => onDelete(b), danger: true },
              ] satisfies MenuItem[]),
            ];
            return (
              <li
                key={b.id}
                data-block-item={b.id}
                draggable
                onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { e.preventDefault(); if (dragOver !== i) setDragOver(i); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => { e.preventDefault(); if (dragging !== null && dragging !== i) move(dragging, i); setDragging(null); setDragOver(null); }}
                onDragEnd={() => { setDragging(null); setDragOver(null); }}
                className={`group flex items-center gap-1 rounded-md border pl-1 pr-0.5 text-sm transition-colors ${selected ? 'border-purple/40 bg-purple/5' : 'border-transparent hover:bg-cream-2'} ${dragOver === i && dragging !== i ? 'ring-2 ring-purple/50' : ''} ${dragging === i ? 'opacity-50' : ''}`}
              >
                <span className="hidden cursor-grab text-subtle md:inline" aria-hidden="true" title="Arrastre para reordenar"><GripVertical size={15} /></span>
                <button
                  type="button"
                  onClick={() => onSelect(b.id)}
                  onKeyDown={onKey(i)}
                  aria-current={selected ? 'true' : undefined}
                  title={[spec?.label ?? b.type, summary].filter(Boolean).join('\n')}
                  className="flex min-h-[44px] min-w-0 flex-1 items-start gap-2 rounded-sm py-2 pl-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm ${selected ? 'bg-purple text-white' : 'bg-cream text-purple'} ${b.hidden ? 'opacity-50' : ''}`} aria-hidden="true">
                    <BlockIcon type={b.type} locked={locked} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`line-clamp-2 font-semibold leading-snug ${b.hidden ? 'text-subtle' : selected ? 'text-purple' : 'text-ink'}`}>
                      {i + 1}. {name}
                    </span>
                    {(summary || page) && <span className="line-clamp-1 text-xs text-subtle">{summary || page}</span>}
                    {(b.hidden || locked) && (
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {b.hidden && <span className="inline-flex items-center gap-1 rounded-full bg-amber/10 px-1.5 text-[11px] font-semibold text-amber"><EyeOff size={11} aria-hidden="true" /> Oculta en el sitio</span>}
                        {locked && <span className="inline-flex items-center gap-1 rounded-full bg-cream px-1.5 text-[11px] font-semibold text-muted"><Lock size={11} aria-hidden="true" /> Fija</span>}
                      </span>
                    )}
                  </span>
                </button>
                {!locked && (
                  <button
                    type="button"
                    aria-label={b.hidden ? 'Mostrar en el sitio' : 'Ocultar del sitio'}
                    aria-pressed={!!b.hidden}
                    title={b.hidden ? 'Oculta: no aparece en el sitio. Pulse para mostrarla.' : 'Ocultar sin eliminar'}
                    className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${b.hidden ? 'text-amber' : 'text-subtle'}`}
                    onClick={() => onToggleHidden(b)}
                  >
                    {b.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
                <MoreMenu iconOnly label={`Acciones de ${name}`} items={menu} />
              </li>
            );
          })}
        </ol>
      )}
      <p id="block-list-help" className="mt-2 text-xs text-subtle">Arrastre para reordenar, o seleccione una sección y use Alt + ↑ / ↓.</p>
    </div>
  );
}
