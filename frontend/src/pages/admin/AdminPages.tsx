import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Trash2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { contentApi, type CmsPageAdmin } from '@/services/api';
import { apiErrors, cmsBase, pageStatusLabel, slugify } from '@/cms/editor/helpers';
import { useAuthStore } from '@/store/authStore';

const TEMPLATES: { value: CmsPageAdmin['template']; label: string }[] = [
  { value: 'simple', label: 'Página sencilla' },
  { value: 'landing', label: 'Landing (campaña)' },
  { value: 'level', label: 'Nivel educativo' },
  { value: 'home', label: 'Inicio' },
];

/** /admin/contenido — CMS page list (BACKLOG P3-4). */
export default function AdminPages() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const base = cmsBase(role);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<CmsPageAdmin | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-pages'], queryFn: async () => (await contentApi.adminListPages()).data });
  const rows = ((data as { results?: CmsPageAdmin[] })?.results ?? (data as CmsPageAdmin[]) ?? []) as CmsPageAdmin[];
  const remove = useMutation({
    mutationFn: (id: number) => contentApi.adminDeletePage(id),
    onSuccess: () => { toast.success('Página eliminada.'); setToDelete(null); qc.invalidateQueries({ queryKey: ['admin-pages'] }); },
    onError: () => toast.error('No se pudo eliminar.'),
  });
  return (
    <>
      <PageHeader title="Páginas del sitio" subtitle="Cree y edite páginas con bloques. Los cambios se publican cuando usted lo decida."
        actions={<Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> Nueva página</Button>} />
      <Card>
        {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading ? <ListSkeleton /> : rows.length === 0 ? (
          <EmptyState icon={FileText} title="Aún no hay páginas" description="Cree la primera página. Hasta publicarla, solo usted la verá." />
        ) : (
          <ul className="divide-y divide-cream" aria-label="Páginas">
            {rows.map((p) => { const st = pageStatusLabel(p); return (
              <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link to={`${base}/${p.id}`} className="font-semibold text-ink hover:text-purple">{p.title}</Link>
                  <p className="truncate text-xs text-subtle">/{p.slug} · {TEMPLATES.find((t) => t.value === p.template)?.label ?? p.template}{p.review_requested_by_name ? ` · solicitó ${p.review_requested_by_name}` : ''}{p.review_note && !p.review_requested_at ? ` · cambios solicitados: ${p.review_note}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={st.tone}>{st.label}</Badge>
                  <Link to={`${base}/${p.id}`} className="btn-outline btn-sm inline-flex items-center gap-1" aria-label={`Editar ${p.title}`}><Pencil size={14} aria-hidden="true" /> Editar</Link>
                  {role === 'admin' && <Button size="sm" variant="ghost" onClick={() => setToDelete(p)} aria-label={`Eliminar ${p.title}`}><Trash2 size={14} aria-hidden="true" /></Button>}
                </div>
              </li>
            ); })}
          </ul>
        )}
      </Card>
      <CreatePageModal open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog open={!!toDelete} title="¿Eliminar página?" message={`"${toDelete?.title}" dejará de existir en el sitio. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar página" loading={remove.isPending} onConfirm={() => toDelete && remove.mutate(toDelete.id)} onClose={() => setToDelete(null)} />
    </>
  );
}

function CreatePageModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [template, setTemplate] = useState<CmsPageAdmin['template']>('simple');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => contentApi.adminCreatePage({ title, slug: slug || slugify(title), template, draft_blocks: [], seo: {} }),
    onSuccess: () => { toast.success('Página creada.'); qc.invalidateQueries({ queryKey: ['admin-pages'] }); onClose(); setTitle(''); setSlug(''); },
    onError: (e) => setErrors(apiErrors(e)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErrors({}); create.mutate(); };
  return (
    <Modal open={open} onClose={onClose} title="Nueva página" maxWidth={480}>
      <form onSubmit={submit} className="space-y-4">
        <Input label="Título" value={title} onChange={(e) => setTitle(e.target.value)} required error={errors.title} />
        <Input label="Dirección (slug)" value={slug || slugify(title)} onChange={(e) => setSlug(slugify(e.target.value))} hint="La página se verá en interlaken.edu.mx/<slug>" error={errors.slug} />
        <div>
          <label className="label" htmlFor="tpl">Plantilla</label>
          <select id="tpl" className="input-field" value={template} onChange={(e) => setTemplate(e.target.value as CmsPageAdmin['template'])}>
            {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        {errors.detail && <p className="text-sm text-coral-600">{errors.detail}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={create.isPending}>Crear</Button></div>
      </form>
    </Modal>
  );
}
