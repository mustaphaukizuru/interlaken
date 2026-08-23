import { Paperclip, X } from 'lucide-react';
import { MediaPicker } from '@/components/admin/MediaPicker';
import type { AnnouncementAttachment } from '@/services/api';

/** Attachments for a comunicado, picked from the media library (BACKLOG P4-4). */
export function AttachmentsField({ value, onChange }: { value: AnnouncementAttachment[]; onChange: (v: AnnouncementAttachment[]) => void }) {
  return (
    <div>
      <span className="label">Adjuntos (máx. 10)</span>
      {value.length > 0 && (
        <ul className="mb-2 space-y-1" aria-label="Adjuntos">
          {value.map((a, i) => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg bg-cream-2 px-2 py-1 text-sm">
              <Paperclip size={14} className="text-subtle" aria-hidden="true" />
              <input className="min-w-0 flex-1 bg-transparent text-ink outline-none" value={a.name} aria-label={`Nombre del adjunto ${i + 1}`} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <button type="button" aria-label={`Quitar ${a.name}`} className="rounded p-0.5 text-subtle hover:text-coral-600" onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {value.length < 10 && (
        <MediaPicker label="" value={null} onChange={(id) => { if (id && !value.some((a) => a.id === id)) onChange([...value, { id, name: `Adjunto ${value.length + 1}` }]); }} />
      )}
      <p className="mt-1 text-xs text-subtle">Suba PDFs o imágenes a la Biblioteca de medios y elíjalos aquí.</p>
    </div>
  );
}

export default AttachmentsField;
