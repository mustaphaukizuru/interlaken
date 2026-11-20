import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pencil, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { allTemplates, loadAllGroups } from '@/cms/sections';
import type { PageTemplate } from '@/cms/sections/types';
import { originalBlocks, pageKindFor, pageStatusLabel } from '@/cms/editor/helpers';
import { invalidateEntity } from '@/hooks/queries/keys';
import { PAGES_ENTITY } from '@/hooks/queries/AdminContentQueries';
import { contentApi, type CmsPageAdmin } from '@/services/api';
import { toPaged } from '@/lib/pagination';
import { apiFieldErrors } from '@/lib/apiErrors';

/**
 * Every public page of the site (docs/CMS-COMPLETION-PLAN.md), customised or
 * not. A page nobody has edited shows «Diseño original»; «Personalizar»
 * creates its draft from the current design, so editing starts from what the
 * site shows today.
 */
export function SitePagesPanel({ base }: { base: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<PageTemplate[] | null>(null);
  useEffect(() => { let alive = true; void loadAllGroups().then(() => { if (alive) setTemplates(allTemplates()); }); return () => { alive = false; }; }, []);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'pages', 'site-index'],
    queryFn: async () => toPaged<CmsPageAdmin>((await contentApi.adminListPages({ page_size: 100 })).data).results,
  });
  const bySlug = useMemo(() => new Map((data ?? []).map((p) => [p.slug, p])), [data]);
  const create = useMutation({
    mutationFn: (t: PageTemplate) => contentApi.adminCreatePage({
      title: t.title, slug: t.slug, template: pageKindFor(t.slug), draft_blocks: originalBlocks(t.slug) ?? [], seo: {},
    }),
    onSuccess: (res) => { void invalidateEntity(qc, PAGES_ENTITY); qc.invalidateQueries({ queryKey: ['admin', 'pages', 'site-index'] }); navigate(`${base}/${res.data.id}`); },
    onError: (e) => toast.error(apiFieldErrors(e).detail || apiFieldErrors(e).slug || 'No se pudo crear el borrador.'),
  });

  if (isError) return <Card><ErrorState title="No se pudieron cargar las páginas" onRetry={() => refetch()} /></Card>;
  if (isLoading || !templates) return <Card><ListSkeleton /></Card>;
  const sorted = [...templates].sort((a, b) => (a.path === '/' ? -1 : b.path === '/' ? 1 : a.path.localeCompare(b.path)));
  return (
    <Card title={`Páginas del sitio (${sorted.length})`}>
      <p className="mb-3 text-sm text-muted">Todas las páginas públicas se pueden editar: textos, fotos, listas y botones; ocultar, reordenar o agregar secciones. Mientras no publique cambios, el sitio muestra el diseño original.</p>
      <ul className="divide-y divide-line" aria-label="Páginas del sitio">
        {sorted.map((t) => {
          const page = bySlug.get(t.slug);
          const st = page ? pageStatusLabel(page) : null;
          return (
            <li key={t.slug} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{t.title}</p>
                <p className="font-mono text-xs text-subtle">{t.path}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {st ? <Badge variant={st.tone}>{st.label}</Badge> : <Badge variant="neutral">Diseño original</Badge>}
                {t.slug !== 'no-encontrada' && (
                  <a href={t.path} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm inline-flex min-h-[36px] items-center gap-1" aria-label={`Ver ${t.title} en el sitio`}><ExternalLink size={14} aria-hidden="true" /></a>
                )}
                {page ? (
                  <Link to={`${base}/${page.id}`} className="btn-outline btn-sm inline-flex min-h-[36px] items-center gap-1" aria-label={`Editar ${t.title}`}><Pencil size={14} aria-hidden="true" /> Editar</Link>
                ) : (
                  <Button size="sm" onClick={() => create.mutate(t)} loading={create.isPending && create.variables?.slug === t.slug} aria-label={`Personalizar ${t.title}`}><Sparkles size={14} aria-hidden="true" /> Personalizar</Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default SitePagesPanel;
