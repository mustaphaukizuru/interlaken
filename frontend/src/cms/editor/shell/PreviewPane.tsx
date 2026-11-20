import type { RefObject } from 'react';
import { Eye, Monitor, Smartphone, Tablet } from 'lucide-react';
import type { Block } from '../../blocks/registry';
import { EditableBlocks } from '../EditableBlocks';

export type Device = 'mobile' | 'tablet' | 'desktop';
const DEVICE_WIDTH: Record<Device, number | undefined> = { mobile: 390, tablet: 820, desktop: undefined };
const DEVICES = [['mobile', Smartphone, 'Móvil'], ['tablet', Tablet, 'Tableta'], ['desktop', Monitor, 'Escritorio']] as const;

interface Props {
  blocks: Block[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  device: Device;
  onDevice: (d: Device) => void;
  previewRef: RefObject<HTMLDivElement>;
}

/** Live preview of the draft with the phone / tablet / desktop switch. */
export function PreviewPane({ blocks, selectedId, onSelect, device, onDevice, previewRef }: Props) {
  return (
    <section className="min-w-0" aria-label="Vista previa">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs text-subtle"><Eye size={14} aria-hidden="true" /> Vista previa en vivo: haga clic en una sección para editarla</span>
        <div role="group" aria-label="Tamaño de pantalla" className="inline-flex rounded-full bg-white p-0.5 ring-1 ring-line">
          {DEVICES.map(([d, Icon, label]) => (
            <button key={d} type="button" aria-pressed={device === d} aria-label={label} title={label} onClick={() => onDevice(d)}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${device === d ? 'bg-purple text-white' : 'text-subtle hover:text-ink'}`}>
              <Icon size={17} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      {/* The preview frame never makes the console scroll sideways: a phone or
          tablet width wider than the space is capped to it. */}
      <div className="overflow-hidden rounded-2xl border border-line bg-cream-2 p-2 sm:p-3">
        <div ref={previewRef} className="mx-auto overflow-hidden rounded-xl bg-white shadow-card" style={{ width: DEVICE_WIDTH[device] ?? '100%', maxWidth: '100%' }}>
          {blocks.length === 0 ? <p className="p-10 text-center text-sm text-muted">Sin contenido todavía.</p> : <EditableBlocks blocks={blocks} selectedId={selectedId} onSelect={onSelect} />}
        </div>
      </div>
    </section>
  );
}
