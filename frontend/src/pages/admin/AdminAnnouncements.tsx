import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, Eye, Megaphone, Pencil, Plus, Power, Send, Siren, Trash2 } from 'lucide-react';
import { DeliveryReportModal } from '@/components/admin/DeliveryReportModal';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { AttachmentsField } from '@/components/admin/AttachmentsField';
import { toLocalInput } from '@/cms/editor/helpers';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import { ANNOUNCEMENTS_ENTITY, useAnnouncementsBulk, useAnnouncementsExport, useAnnouncementsList } from '@/hooks/queries/AdminContentQueries';
import { invalidateEntity } from '@/hooks/queries/keys';
import { PageHeader } from '@/components/layout/PageHeader';
import { portalApi, type AnnouncementAttachment, type BulkActionDef } from '@/services/api';
import { idsParam, type ExportFormat } from '@/services/dataOps';
import { apiErrorMessage } from '@/lib/apiErrors';
import { formatDateTime } from '@/lib/format';
import { AUDIENCES as AUDIENCE, announcementStatus, audienceMeta, type AdminAnnouncement as Announcement } from '@/lib/status/AdminAnnouncementStatus';

const STATE_OPTIONS = [
  { value: '1', label: 'Activos' },
  { value: '0', label: 'Inactivos' },
];

const BULK_ACTIONS: BulkActionDef[] = [
  { name: 'activate', label: 'Activar', planVerb: 'Se activarán', icon: Power },
  { name: 'deactivate', label: 'Desactivar (archivar)', planVerb: 'Se desactivarán', icon: Archive },
  { name: 'duplicate', label: 'Duplicar', planVerb: 'Se duplicarán como borrador', icon: Copy },
  { name: 'delete', label: 'Eliminar no enviados', planVerb: 'Se eliminarán', danger: true, icon: Trash2 },
];

const EMPTY = { title: '', body: '', audience: 'all', is_active: true, push_enabled: true, show_on_site: false, site_until: null as string | null, site_link: '', publish_at: null as string | null, requires_ack: false, attachments: [] as AnnouncementAttachment[] };
const EMPTY_ALERT = { title: '', message: '', audience: 'parents', whatsapp: false };

export default function AdminAnnouncements() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  // ?nuevo=1 deep link from the header quick actions (P1-E8).
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('nuevo') === '1');
  const [toDelete, setToDelete] = useState<Announcement | null>(null);
  const [report, setReport] = useState<Announcement | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertForm, setAlertForm] = useState(EMPTY_ALERT);
  const [alertConfirm, setAlertConfirm] = useState(false);

  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters = {
    q: get('q') || undefined,
    active: get('estado') || undefined,
    audience: get('audiencia') || undefined,
    scheduled: get('programado') || undefined,
    requires_ack: get('enterado') || undefined,
    from: get('desde') || undefined,
    to: get('hasta') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data: paged, isLoading, isError, refetch } = useAnnouncementsList({ page, ...filters });
  const exportAnnouncements = useAnnouncementsExport();
  const bulk = useAnnouncementsBulk();
  const rows = paged?.results;
  const count = paged?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const [bulkAction, setBulkAction] = useState<BulkActionDef | null>(null);

  const invalidate = () => invalidateEntity(qc, ANNOUNCEMENTS_ENTITY);
  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportAnnouncements.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        await portalApi.adminUpdateAnnouncement(editing.id, form);
      } else {
        await portalApi.adminCreateAnnouncement(form);
      }
    },
    onSuccess: () => {
      void invalidate();
      toast.success(editing ? 'Comunicado actualizado.' : 'Comunicado publicado.');
      setOpen(false);
    },
    onError: () => toast.error('No se pudo guardar el comunicado.'),
  });

  const toggleActive = useMutation({
    mutationFn: (a: Announcement) => portalApi.adminUpdateAnnouncement(a.id, { is_active: !a.is_active }),
    onSuccess: () => { void invalidate(); },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'No se pudo cambiar el estado.')),
  });

  const remove = useMutation({
    mutationFn: (id: number) => portalApi.adminDeleteAnnouncement(id),
    onSuccess: () => { void invalidate(); toast.success('Comunicado eliminado.'); setToDelete(null); },
    onError: (e: unknown) => { toast.error(apiErrorMessage(e, 'No se pudo eliminar.')); setToDelete(null); },
  });

  const broadcast = useMutation({
    mutationFn: () =>
      portalApi.adminEmergencyBroadcast({
        title: alertForm.title.trim(),
        message: alertForm.message.trim(),
        audience: alertForm.audience,
        whatsapp: alertForm.whatsapp,
      }),
    onSuccess: (resp) => {
      const d = resp.data as { notified: number; dispatched: number; whatsapp_sent: number };
      void invalidate();
      setAlertOpen(false);
      setAlertConfirm(false);
      setAlertForm(EMPTY_ALERT);
      toast.success(
        `Aviso urgente enviado: ${d.notified} notificados` +
          (d.dispatched ? `, ${d.dispatched} por correo/push` : '') +
          (d.whatsapp_sent ? `, ${d.whatsapp_sent} por WhatsApp` : '') +
          '.',
      );
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'No se pudo enviar el aviso urgente.')),
  });

  const openNew = () => { setEditing(null); setForm(EMPTY); setOpen(true); };

  // Command-palette deep link: /admin/comunicados?nuevo=1 opens the composer
  // (same modal, same validations) and consumes the param.
  // ?emergencia=1 (header quick action "Emergencia (broadcast)") opens the
  // urgent-notice modal instead.
  const [searchParams, setSearchParams] = useSearchParams();
  const wantsNew = searchParams.get('nuevo');
  const wantsAlert = searchParams.get('emergencia');
  useEffect(() => {
    if (!wantsNew && !wantsAlert) return;
    // Suppressed: one-shot URL command — the param is external navigation
    // state consumed (deleted) right after, so the composer state cannot be
    // derived from it and the setState cannot cascade.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (wantsAlert) setAlertOpen(true);
    else openNew();
    /* eslint-enable react-hooks/set-state-in-effect */
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('nuevo');
      next.delete('emergencia');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsNew, wantsAlert]);

  const openEdit = (a: Announcement) => {
    setEditing(a);
    setForm({
      title: a.title, body: a.body, audience: a.audience,
      is_active: a.is_active, push_enabled: a.push_enabled ?? true,
      show_on_site: a.show_on_site ?? false, site_until: a.site_until ?? null, site_link: a.site_link ?? '',
      publish_at: a.publish_at ?? null, requires_ack: a.requires_ack ?? false, attachments: a.attachments ?? [],
    });
    setOpen(true);
  };
  const openAlert = () => {
    setAlertForm(EMPTY_ALERT);
    setAlertConfirm(false);
    setAlertOpen(true);
  };

  const columns: Column<Announcement>[] = [
    {
      id: 'title', header: 'Comunicado', sortKey: 'title', hideable: false, minWidth: 240,
      cell: (a) => (
        <div className="min-w-0">
          <p className={`font-semibold ${a.is_active ? 'text-ink' : 'text-subtle'}`}>{a.title}</p>
          <p className="line-clamp-1 text-xs text-muted">{a.body}</p>
        </div>
      ),
    },
    { id: 'audience', header: 'Dirigido a', sortKey: 'audience', minWidth: 110, cell: (a) => { const m = audienceMeta(a.audience); return <Badge variant={m.variant}>{m.label}</Badge>; } },
    { id: 'status', header: 'Estado', sortKey: 'active', minWidth: 110, cell: (a) => { const s = announcementStatus(a); return <Badge variant={s.variant}>{s.label}</Badge>; } },
    { id: 'created', header: 'Creado', sortKey: 'created', minWidth: 150, className: 'whitespace-nowrap text-xs text-muted', cell: (a) => formatDateTime(a.created_at) },
    { id: 'publish_at', header: 'Programado', sortKey: 'publish_at', minWidth: 150, defaultHidden: true, className: 'whitespace-nowrap text-xs text-muted', cell: (a) => formatDateTime(a.publish_at) || '—' },
    {
      id: 'reads', header: 'Leídos', sortKey: 'reads', align: 'right', minWidth: 90, className: 'tabular-nums text-muted',
      cell: (a) => <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" aria-hidden="true" /> {a.read_count} leídos</span>,
    },
    { id: 'ack', header: 'Enterados', align: 'right', minWidth: 90, defaultHidden: true, className: 'tabular-nums text-muted', cell: (a) => (a.requires_ack ? a.ack_count ?? 0 : '—') },
    { id: 'author', header: 'Autor', minWidth: 130, defaultHidden: true, className: 'text-xs text-muted', cell: (a) => a.created_by_name || '—' },
  ];

  return (
    <>
      <PageHeader
        title="Comunicados"
        subtitle="Publica avisos para las familias, alumnos y personal."
        actions={(
          <div className="flex flex-wrap gap-2">
            <ExportMenu formats={['csv', 'xlsx']} filenamePrefix="comunicados" selectedCount={selection.count} fetch={fetchExport} />
            <Button variant="danger" onClick={openAlert}>
              <Siren className="h-4 w-4" aria-hidden="true" /> Aviso urgente
            </Button>
            <Button onClick={openNew}><Plus className="h-4 w-4" /> Nuevo comunicado</Button>
          </div>
        )}
      />

      <Card title={`${count.toLocaleString('es-MX')} comunicados`}>
        <DataTable<Announcement>
          tableId="announcements"
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          rowLabel={(a) => `comunicado ${a.title}`}
          caption="Comunicados"
          sort={sort}
          onSort={(next: SortState) => set({ orden: serializeSort(next), page: null })}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="comunicados"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          columnControls
          resizable
          pinFirstColumn
          selection={selection}
          rowActions={(a) => (
            <>
              <button type="button" onClick={() => toggleActive.mutate(a)}
                disabled={toggleActive.isPending && toggleActive.variables?.id === a.id}
                className="min-h-[36px] rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-muted hover:bg-cream disabled:opacity-50">
                {toggleActive.isPending && toggleActive.variables?.id === a.id
                  ? 'Guardando…'
                  : a.is_active ? 'Desactivar' : 'Activar'}
              </button>
              <button type="button" onClick={() => setReport(a)} aria-label={`Ver entrega del comunicado "${a.title}"`}
                className="rounded-lg p-2 text-subtle hover:bg-cream hover:text-ink"><Send className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" onClick={() => openEdit(a)} aria-label={`Editar el comunicado "${a.title}"`}
                className="rounded-lg p-2 text-subtle hover:bg-cream hover:text-ink"><Pencil className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" onClick={() => setToDelete(a)} aria-label={`Eliminar el comunicado "${a.title}"`}
                className="rounded-lg p-2 text-subtle hover:bg-coral-50 hover:text-coral-dark"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
            </>
          )}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Título o mensaje…', label: 'Buscar comunicados' }}
              tabs={{ paramKey: 'estado', options: STATE_OPTIONS, allLabel: 'Todos', label: 'Filtrar por estado' }}
              selects={[
                { key: 'audiencia', label: 'Dirigido a', options: AUDIENCE.map(({ value, label }) => ({ value, label })), allLabel: 'Todas las audiencias' },
                { key: 'programado', label: 'Programación', options: [{ value: '1', label: 'Programados' }, { value: '0', label: 'Ya enviados o inmediatos' }], allLabel: 'Con o sin programación' },
                { key: 'enterado', label: 'Enterado', options: [{ value: '1', label: 'Piden enterado' }, { value: '0', label: 'Sin enterado' }], allLabel: 'Con o sin enterado' },
              ]}
              dateRange={{ idPrefix: 'comunicados' }}
            />
          )}
          bulkBar={(
            <BulkActionBar
              count={selection.count}
              allMatching={selection.allMatching}
              allMatchingCount={count}
              onSelectAllMatching={selection.onSelectAllMatching}
              onClear={selection.onClear}
              actions={BULK_ACTIONS}
              onAction={setBulkAction}
              itemLabel="comunicados"
              gender="m"
              exportMenu={<ExportMenu label="Exportar seleccionados" formats={['csv', 'xlsx']} filenamePrefix="comunicados" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{
            icon: Megaphone,
            title: 'Sin comunicados',
            description: 'Los avisos que publiques aparecerán aquí y en el portal de las familias.',
            action: <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" /> Nuevo comunicado</Button>,
          }}
        />
      </Card>

      <BulkConfirmDialog
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        action={bulkAction}
        entityLabel="comunicados"
        gender="m"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={() => selection.onClear()}
      />

      {/* Composer */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar comunicado' : 'Nuevo comunicado'} maxWidth={520}>
        <div className="space-y-4">
          <Input label="Título" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Ej. Suspensión de clases" />
          <div>
            <label htmlFor="ann-body" className="label">Mensaje</label>
            <textarea id="ann-body" className="input-field min-h-[110px] resize-none" value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="Escribe el comunicado…" />
          </div>
          <div>
            <label htmlFor="ann-audience" className="label">Dirigido a</label>
            <select id="ann-audience" className="input-field" value={form.audience}
              onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value }))}>
              {AUDIENCE.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <RecipientCountHint audience={form.audience} />
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4 rounded border-line text-purple focus-visible:ring-2 focus-visible:ring-purple/40" />
            Publicado (visible en el portal)
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={form.push_enabled} onChange={(e) => setForm((f) => ({ ...f, push_enabled: e.target.checked }))}
              className="h-4 w-4 rounded border-line text-purple focus-visible:ring-2 focus-visible:ring-purple/40" />
            Enviar notificación push a los dispositivos suscritos
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={form.show_on_site} onChange={(e) => setForm((f) => ({ ...f, show_on_site: e.target.checked }))}
              className="h-4 w-4 rounded border-line text-purple focus-visible:ring-2 focus-visible:ring-purple/40" />
            Publicar en el sitio público (franja de aviso arriba del encabezado)
          </label>
          {form.show_on_site && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Mostrar hasta (opcional)" type="date" value={form.site_until ?? ''} onChange={(e) => setForm((f) => ({ ...f, site_until: e.target.value || null }))} />
              <Input label="Enlace «Ver más» (opcional)" value={form.site_link} onChange={(e) => setForm((f) => ({ ...f, site_link: e.target.value }))} placeholder="/calendario" />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Programar envío (opcional)" type="datetime-local" value={toLocalInput(form.publish_at)} onChange={(e) => setForm((f) => ({ ...f, publish_at: e.target.value ? new Date(e.target.value).toISOString() : null }))} hint="Vacío = se envía al publicar." />
            <label className="flex min-h-[44px] items-center gap-2 self-end text-sm text-muted">
              <input type="checkbox" checked={form.requires_ack} onChange={(e) => setForm((f) => ({ ...f, requires_ack: e.target.checked }))} className="h-4 w-4 rounded border-line text-purple focus-visible:ring-2 focus-visible:ring-purple/40" />
              Pedir «Enterado» a cada familia
            </label>
          </div>
          <AttachmentsField value={form.attachments} onChange={(attachments) => setForm((f) => ({ ...f, attachments }))} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.title.trim() || !form.body.trim()}>
              {editing ? 'Guardar' : 'Publicar'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={alertOpen}
        onClose={() => { setAlertOpen(false); setAlertConfirm(false); }}
        title="Aviso urgente"
        maxWidth={520}
      >
        <div className="space-y-4">
          <p className="rounded-xl border border-coral/30 bg-coral/5 px-3 py-2 text-sm text-ink">
            Se creará un comunicado y se notificará de inmediato (app + primer lote de correo/push).
            El resto lo completa el cron. Use solo para contingencias reales.
          </p>
          <Input
            label="Título"
            value={alertForm.title}
            onChange={(e) => setAlertForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Ej. Suspensión de clases mañana"
          />
          <div>
            <label htmlFor="alert-body" className="label">Mensaje</label>
            <textarea
              id="alert-body"
              className="input-field min-h-[110px] resize-none"
              value={alertForm.message}
              onChange={(e) => setAlertForm((f) => ({ ...f, message: e.target.value }))}
              placeholder="Detalle claro de la contingencia y qué deben hacer las familias…"
            />
          </div>
          <div>
            <label htmlFor="alert-audience" className="label">Dirigido a</label>
            <select
              id="alert-audience"
              className="input-field"
              value={alertForm.audience}
              onChange={(e) => setAlertForm((f) => ({ ...f, audience: e.target.value }))}
            >
              {AUDIENCE.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <RecipientCountHint audience={alertForm.audience} />
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={alertForm.whatsapp}
              onChange={(e) => setAlertForm((f) => ({ ...f, whatsapp: e.target.checked }))}
              className="h-4 w-4 rounded border-line text-purple focus-visible:ring-2 focus-visible:ring-purple/40"
            />
            También WhatsApp (solo números registrados; requiere Cloud API)
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={alertConfirm}
              onChange={(e) => setAlertConfirm(e.target.checked)}
              className="h-4 w-4 rounded border-line text-pink focus-visible:ring-2 focus-visible:ring-pink/40"
            />
            Confirmo que este aviso es urgente y debe enviarse ahora a la audiencia seleccionada.
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setAlertOpen(false); setAlertConfirm(false); }}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => broadcast.mutate()}
              loading={broadcast.isPending}
              disabled={
                !alertConfirm
                || !alertForm.title.trim()
                || !alertForm.message.trim()
                || broadcast.isPending
              }
            >
              Enviar aviso urgente
            </Button>
          </div>
        </div>
      </Modal>

      <DeliveryReportModal announcementId={report?.id ?? null} title={report?.title} onClose={() => setReport(null)} />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Eliminar comunicado"
        message={`Se eliminará "${toDelete?.title}" de forma permanente. Solo se pueden eliminar comunicados que aún no se enviaron; los enviados se desactivan para archivarlos.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
      />
    </>
  );
}

/** Audience-size preview: how many active accounts publish would notify. */
function RecipientCountHint({ audience }: { audience: string }) {
  const { data } = useQuery({
    queryKey: ['announcement-recipient-count', audience],
    queryFn: async () => (await portalApi.getAnnouncementRecipientCount(audience)).data,
    staleTime: 60_000,
  });
  if (!data) return null;
  const noun = audience === 'staff' ? 'cuenta(s) del personal' : 'familia(s)';
  return (
    <p className="mt-1.5 text-xs text-subtle">
      Se notificará a ~{data.count} {noun}.
    </p>
  );
}
