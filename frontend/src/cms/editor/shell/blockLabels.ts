import { blockSpec, type Block } from '../../blocks/registry';

/** "Inicio · Portada" → name "Portada", page "Inicio". */
export function splitLabel(type: string): { name: string; page: string } {
  const label = blockSpec(type)?.label ?? type;
  const at = label.indexOf(' · ');
  return at > 0 ? { name: label.slice(at + 3), page: label.slice(0, at) } : { name: label, page: '' };
}

/** A short hint of what a block says, so two blocks of the same kind can be told apart. */
export function blockSummary(b: Block): string {
  const p = b.props ?? {};
  for (const k of ['title', 'heading', 'headline', 'label', 'subtitle', 'text', 'html', 'intro', 'message']) {
    const v = p[k];
    if (typeof v === 'string' && v.trim()) return v.replace(/<[^>]+>/g, ' ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
  }
  return '';
}
