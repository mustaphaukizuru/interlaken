import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus, Pencil, Trash2, Eye, Siren } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { portalApi } from '@/services/api';

interface Announcement {
  id: number; title: string; body: string; audience: string;
  is_active: boolean; created_at: string; created_by_name: string; read_count: number;
}

const AUDIENCE: { value: string; label: string; variant: 'info' | 'success' | 'warning' | 'neutral' }[] = [
  { value: 'all',      label: 'Todos',    variant: 'info' },
  { value: 'parents',  label: 'Padres',   variant: 'success' },
  { value: 'students', label: 'Alumnos',  variant: 'warning' },
  { value: 'staff',    label: 'Personal', variant: 'neutral' },
];
const audienceMeta = (a: string) => AUDIENCE.find((x) => x.value === a) ?? AUDIENCE[0];

const EMPTY = { title: '', body: '', audience: 'all', is_active: true };
const EMPTY_ALERT = { title: '', message: '', audience: 'parents', whatsapp: false };

export default function AdminAnnouncements() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Announcement | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertForm, setAlertForm] = useState(EMPTY_ALERT);
  const [alertConfirm, setAlertConfirm] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-announcements'],
    queryFn: async () => (await portalApi.adminListAnnouncements()).data.results as Announcement[],
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-announcements'] });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        await portalApi.adminUpdateAnnouncement(editing.id, form);
      } else {
        await portalApi.adminCreateAnnouncement(form);
      }
    },
    onSuccess: () => {
      invalidate();
      toast.success(editing ? 'Comunicado actualizado.' : 'Comunicado publicado.');
      setOpen(false);
    },
    onError: () => toast.error('No se pudo guardar el comunicado.'),
  });

  const toggleActive = useMutation({
    mutationFn: (a: Announcement) => portalApi.adminUpdateAnnouncement(a.id, { is_active: !a.is_active }),
    onSuccess: invalidate,
    onError: () => toast.error('No se pudo cambiar el estado.'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => portalApi.adminDeleteAnnouncement(id),
    onSuccess: () => { invalidate(); toast.success('Comunicado eliminado.'); setToDelete(null); },
    onError: () => toast.error('No se pudo eliminar.'),
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
      invalidate();
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
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || 'No se pudo enviar el aviso urgente.');
    },
  });

  const openNew = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (a: Announcement) => {
    setEditing(a);
    setForm({ title: a.title, body: a.body, audience: a.audience, is_active: a.is_active });
    setOpen(true);
  };
  const openAlert = () => {
    setAlertForm(EMPTY_ALERT);
    setAlertConfirm(false);
    setAlertOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Comunicados"
        subtitle="Publica avisos para las familias, alumnos y personal."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={openAlert}>
              <Siren className="h-4 w-4" aria-hidden="true" /> Aviso urgente
            </Button>
            <Button onClick={openNew}><Plus className="h-4 w-4" /> Nuevo comunicado</Button>
          </div>
        )}
      />

      <Card>
        {isLoading ? (
          <TableSkeleton />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : !data?.length ? (
          <EmptyState icon={Megaphone} title="Sin comunicados"
            description="Los avisos que publiques aparecerán aquí y en el portal de las familias." />
        ) : (
          <ul className="divide-y divide-line">
            {data.map((a) => {
              const meta = audienceMeta(a.audience);
              return (
                <li key={a.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`font-semibold ${a.is_active ? 'text-ink' : 'text-subtle line-through'}`}>{a.title}</p>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {!a.is_active && <Badge variant="neutral">Inactivo</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{a.body}</p>
                    <p className="mt-1 flex items-center gap-3 text-xs text-subtle">
                      <span>{format(new Date(a.created_at), "d MMM yyyy", { locale: es })}</span>
                      <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" /> {a.read_count} leídos</span>
                      {a.created_by_name && a.created_by_name !== '—' && <span>· {a.created_by_name}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={() => toggleActive.mutate(a)} disabled={toggleActive.isPending}
                      className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-muted hover:bg-cream disabled:opacity-50">
                      {a.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                    <button type="button" onClick={() => openEdit(a)} aria-label="Editar"
                      className="rounded-lg p-2 text-subtle hover:bg-cream hover:text-ink"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => setToDelete(a)} aria-label="Eliminar"
                      className="rounded-lg p-2 text-subtle hover:bg-coral-50 hover:text-coral-dark"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

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
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4 rounded border-line text-purple focus-visible:ring-2 focus-visible:ring-purple/40" />
            Publicado (visible en el portal)
          </label>
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

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Eliminar comunicado"
        message={`Se eliminará "${toDelete?.title}" de forma permanente. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        loading={remove.isPending}
      />
    </>
  );
}
