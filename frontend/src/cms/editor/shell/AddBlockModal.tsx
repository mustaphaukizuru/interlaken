import { useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { BLOCKS } from '../../blocks/registry';
import { allSections as allSectionSpecs } from '../../sections';
import { GROUP_LABELS } from '../../sections/loaders';

/** «Agregar»: any designed section of any page, or a generic block. */
export function AddBlockModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (type: string) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const match = (b: { label: string; description: string }) => !needle || `${b.label} ${b.description}`.toLowerCase().includes(needle);
  // Locked sections carry a form or the booking widget: one per page, never added twice.
  const sections = allSectionSpecs().filter((b) => !b.locked && match(b));
  const groups = Object.entries(GROUP_LABELS)
    .map(([key, label]) => ({ key, label, items: sections.filter((b) => b.group === key) }))
    .filter((g) => g.items.length > 0);
  const generic = BLOCKS.filter(match);
  const card = (b: { type: string; label: string; description: string }) => (
    <li key={b.type}>
      <button type="button" onClick={() => onPick(b.type)} className="w-full rounded-xl border border-line p-3 text-left hover:border-purple hover:bg-purple/5">
        <span className="block font-semibold text-ink">{b.label}</span>
        <span className="block text-xs text-muted">{b.description}</span>
      </button>
    </li>
  );
  return (
    <Modal open={open} onClose={onClose} title="Agregar bloque" maxWidth={720}>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <input className="input-field pl-9" placeholder="Buscar bloque…" aria-label="Buscar bloque" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-[65vh] space-y-5 overflow-y-auto">
        {generic.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-subtle">Bloques generales</h3>
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="Bloques generales">{generic.map(card)}</ul>
          </section>
        )}
        {groups.map((g) => (
          <section key={g.key}>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-subtle">Secciones de {g.label}</h3>
            <ul className="grid gap-2 sm:grid-cols-2" aria-label={`Secciones de ${g.label}`}>{g.items.map(card)}</ul>
          </section>
        ))}
        {generic.length === 0 && groups.length === 0 && <p className="py-6 text-center text-sm text-muted">Ningún bloque coincide con la búsqueda.</p>}
      </div>
    </Modal>
  );
}
