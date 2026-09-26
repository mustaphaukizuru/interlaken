import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCog, Plus, KeyRound, Copy, Check, FileUp, UserX, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { parseSort, serializeSort, type SortState } from '@/components/ui/SortableTh';
import { ExportMenu } from '@/components/admin/ExportMenu';
import { FilterBar } from '@/components/admin/FilterBar';
import { BulkActionBar } from '@/components/admin/BulkActionBar';
import { BulkConfirmDialog } from '@/components/admin/BulkConfirmDialog';
import { ImportDialog } from '@/components/admin/ImportDialog';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import { adminKeys } from '@/hooks/queries/keys';
import { STAFF_ENTITY, staffImportApi, useStaffBulk, useStaffExport, useStaffList, type StaffListParams } from '@/hooks/queries/staff';
import { useAuthStore } from '@/store/authStore';
import { portalApi, type StaffUser } from '@/services/api';
import { idsParam, type BulkActionDef, type ExportFormat } from '@/services/dataOps';
import { apiErrorMessage, fieldErrorsOrNull } from '@/lib/apiErrors';

const ROLE: Record<string, string> = { admin: 'Administrador', staff: 'Personal' };
const ROLE_OPTIONS = Object.entries(ROLE).map(([value, label]) => ({ value, label }));
const ACTIVE_TABS = [
  { value: '1', label: 'Activas' },
  { value: '0', label: 'Inactivas' },
];
const IMPORT_HEADERS = [{ key: 'correo', required: true }, { key: 'nombre', required: true }, { key: 'apellidos' }, { key: 'rol' }];
const BULK_ACTIONS: BulkActionDef[] = [
  { name: 'deactivate', label: 'Desactivar', danger: true, icon: UserX, planVerb: 'Se desactivarán' },
  { name: 'reactivate', label: 'Reactivar', icon: UserCheck, planVerb: 'Se reactivarán' },
];
const ROW_ACTION =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-purple hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-[36px]';

/**
 * /admin/usuarios — staff accounts on the Data Ops UI foundation (BACKLOG P1-H1):
 * search, rol/activo filters in the URL, sort on every column, selection with
 * bulk deactivate/reactivate (per-row guards on the server), export of the view,
 * import = invite many. No delete: deactivation is the archive.
 */
export default function AdminStaffUsers() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [toToggle, setToToggle] = useState<StaffUser | null>(null);
  const [toReset, setToReset] = useState<StaffUser | null>(null);
  const [revealed, setRevealed] = useState<{ user: StaffUser; password: string } | null>(null);
  const [confirming, setConfirming] = useState<BulkActionDef | null>(null);

  const [page, setPage] = useUrlPage();
  const { get, set } = useUrlFilters();
  const sort = parseSort(get('orden'));
  const filters: Omit<StaffListParams, 'page'> = {
    q: get('q') || undefined,
    role: get('rol') || undefined,
    active: get('activo') || undefined,
    ordering: serializeSort(sort) || undefined,
  };
  const { data, isLoading, isError, refetch } = useStaffList({ page, ...filters });
  const exportStaff = useStaffExport();
  const bulk = useStaffBulk();
  const rows = data?.results;
  const count = data?.count ?? 0;
  const selection = useRowSelection(count, JSON.stringify(filters));
  const onSort = (next: SortState) => set({ orden: serializeSort(next), page: null });

  const invalidate = () => qc.invalidateQueries({ queryKey: adminKeys.entity(STAFF_ENTITY) });
  const onErr = (e: unknown) => toast.error(apiErrorMessage(e, 'No se pudo guardar.'));
  const patch = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Pick<StaffUser, 'role' | 'is_active'>> }) => portalApi.updateStaff(id, data),
    onSuccess: () => { invalidate(); setToToggle(null); toast.success('Actualizado.'); },
    onError: onErr,
  });
  const reset = useMutation({
    mutationFn: (u: StaffUser) => portalApi.resetStaffPassword(u.id).then((r) => ({ user: u, password: r.data.temporary_password })),
    onSuccess: (r) => { setToReset(null); setRevealed(r); },
    onError: onErr,
  });

  const fetchExport = (fmt: ExportFormat, { selectedOnly }: { selectedOnly: boolean }) =>
    exportStaff.mutateAsync({ ...filters, fmt, ids: selectedOnly && !selection.allMatching ? idsParam(selection.ids) : undefined });

  const columns: Column<StaffUser>[] = [
    {
      id: 'name', header: 'Nombre', sortKey: 'name', hideable: false, minWidth: 180,
      cell: (u) => (
        <span className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
          {u.full_name || u.email}
          {u.id === me?.id && <span className="text-xs font-normal text-subtle">(usted)</span>}
          {u.is_superuser && <Badge variant="warning">Superusuario</Badge>}
        </span>
      ),
    },
    { id: 'email', header: 'Correo', sortKey: 'email', minWidth: 180, className: 'text-xs text-subtle', cell: (u) => u.email },
    {
      id: 'role', header: 'Rol', sortKey: 'role', minWidth: 150,
      cell: (u) => (u.is_superuser || u.id === me?.id ? (
        <Badge variant={u.role === 'admin' ? 'info' : 'neutral'}>{ROLE[u.role] ?? u.role}</Badge>
      ) : (
        <select
          aria-label={`Rol de ${u.email}`}
          className="input-field min-h-[36px] w-auto py-1 text-xs"
          value={u.role}
          disabled={patch.isPending}
          onChange={(e) => patch.mutate({ id: u.id, data: { role: e.target.value as StaffUser['role'] } })}
        >
          <option value="admin">Administrador</option>
          <option value="staff">Personal</option>
        </select>
      )),
    },
    {
      id: 'is_active', header: 'Estado', sortKey: 'is_active', minWidth: 100,
      cell: (u) => <Badge variant={u.is_active ? 'success' : 'neutral'}>{u.is_active ? 'Activa' : 'Inactiva'}</Badge>,
    },
    {
      id: 'last_login', header: 'Último acceso', sortKey: 'last_login', minWidth: 120, className: 'text-xs text-subtle',
      cell: (u) => (u.last_login ? new Date(u.last_login).toLocaleDateString('es-MX') : 'Nunca'),
    },
    {
      id: 'date_joined', header: 'Alta', sortKey: 'date_joined', defaultHidden: true, minWidth: 110, className: 'text-xs text-subtle',
      cell: (u) => new Date(u.date_joined).toLocaleDateString('es-MX'),
    },
    {
      id: 'has_password', header: 'Contraseña', defaultHidden: true, minWidth: 110, className: 'text-xs text-subtle',
      cell: (u) => (u.has_password ? 'Asignada' : 'Sin asignar'),
    },
  ];

  const anyFilter = !!(filters.q || filters.role || filters.active);

  return (
    <>
      <PageHeader
        title="Usuarios del personal"
        subtitle="Cuentas de administración y personal del portal. Las cuentas superusuario se gestionan en el panel técnico."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setInviteOpen(true)}><Plus size={16} aria-hidden="true" /> Invitar</Button>
            <button type="button" className="btn-outline min-h-[44px] text-sm sm:min-h-[40px]" onClick={() => setImportOpen(true)}>
              <FileUp size={16} aria-hidden="true" /> Importar
            </button>
            <ExportMenu filenamePrefix="usuarios" selectedCount={selection.count} fetch={fetchExport} />
          </div>
        )}
      />
      <Card title={`${count.toLocaleString('es-MX')} cuentas`}>
        <DataTable<StaffUser>
          tableId="staff"
          columns={columns}
          rows={rows}
          rowKey={(u) => u.id}
          rowLabel={(u) => u.email}
          caption="Usuarios del personal"
          rowClassName={(u) => (u.is_active ? '' : 'opacity-70')}
          sort={sort}
          onSort={onSort}
          page={page}
          count={count}
          onPage={setPage}
          itemLabel="cuentas"
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          columnControls
          pinFirstColumn
          selection={selection}
          rowActions={(u) => (u.is_superuser || u.id === me?.id ? null : (
            <>
              <button type="button" className={ROW_ACTION} onClick={() => setToReset(u)} aria-label={`Generar contraseña para ${u.email}`}>
                <KeyRound className="h-4 w-4" aria-hidden="true" /> Contraseña
              </button>
              <button type="button" className={ROW_ACTION} onClick={() => setToToggle(u)} aria-label={`${u.is_active ? 'Desactivar' : 'Reactivar'} ${u.email}`}>
                {u.is_active ? 'Desactivar' : 'Reactivar'}
              </button>
            </>
          ))}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Buscar por nombre o correo…', label: 'Buscar usuarios' }}
              tabs={{ paramKey: 'activo', options: ACTIVE_TABS, allLabel: 'Todas', label: 'Filtrar por estado' }}
              selects={[{ key: 'rol', label: 'Rol', options: ROLE_OPTIONS, allLabel: 'Todos los roles' }]}
            />
          )}
          bulkBar={(
            <BulkActionBar
              count={selection.count}
              allMatching={selection.allMatching}
              allMatchingCount={count}
              onSelectAllMatching={selection.onSelectAllMatching}
              onClear={selection.onClear}
              itemLabel="cuentas"
              actions={BULK_ACTIONS}
              onAction={setConfirming}
              busy={bulk.isPending}
              exportMenu={<ExportMenu label="Exportar seleccionadas" filenamePrefix="usuarios" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{
            icon: UserCog,
            title: anyFilter ? 'Sin resultados' : 'Sin cuentas',
            description: anyFilter ? 'Ninguna cuenta coincide con los filtros.' : 'Invite al personal para que aparezca aquí.',
            action: anyFilter ? undefined : <Button size="sm" onClick={() => setInviteOpen(true)}><Plus size={14} aria-hidden="true" /> Invitar</Button>,
          }}
        />
      </Card>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={(r) => { invalidate(); setRevealed(r); }} />
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Invitar personal desde un archivo"
        entity={STAFF_ENTITY}
        api={staffImportApi}
        headers={IMPORT_HEADERS}
        templatePrefix="personal"
        description={<>Una fila por persona. <code>rol</code>: <em>staff</em> (Personal) o <em>admin</em>. Las cuentas se crean sin contraseña: la persona entra con Google o usted genera una con «Contraseña».</>}
      />
      <BulkConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        action={confirming}
        entityLabel="cuentas"
        ids={selection.ids}
        allMatching={selection.allMatching}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        onDone={(r) => { if (!r.failed.length) selection.onClear(); }}
      />

      <ConfirmDialog
        open={!!toToggle}
        onClose={() => setToToggle(null)}
        onConfirm={() => toToggle && patch.mutate({ id: toToggle.id, data: { is_active: !toToggle.is_active } })}
        title={toToggle?.is_active ? 'Desactivar cuenta' : 'Reactivar cuenta'}
        message={toToggle?.is_active ? `${toToggle.email} no podrá iniciar sesión y sus sesiones abiertas se cerrarán.` : `${toToggle?.email} podrá volver a iniciar sesión.`}
        confirmLabel={toToggle?.is_active ? 'Desactivar' : 'Reactivar'}
        loading={patch.isPending}
      />
      <ConfirmDialog
        open={!!toReset}
        onClose={() => setToReset(null)}
        onConfirm={() => toReset && reset.mutate(toReset)}
        title="Generar nueva contraseña"
        message={`Se generará una contraseña temporal para ${toReset?.email ?? ''} y se cerrarán sus sesiones.`}
        confirmLabel="Generar"
        loading={reset.isPending}
      />
      <RevealModal data={revealed} onClose={() => setRevealed(null)} />
    </>
  );
}

function InviteModal({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited: (r: { user: StaffUser; password: string }) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Invitar al personal" maxWidth={480}>
      <InviteForm key={String(open)} onClose={onClose} onInvited={onInvited} />
    </Modal>
  );
}

function InviteForm({ onClose, onInvited }: { onClose: () => void; onInvited: (r: { user: StaffUser; password: string }) => void }) {
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '', role: 'staff' as StaffUser['role'] });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const invite = useMutation({
    mutationFn: () => portalApi.inviteStaff(form),
    onSuccess: ({ data }) => { onInvited({ user: data, password: data.temporary_password }); onClose(); },
    onError: (e: unknown) => { const f = fieldErrorsOrNull(e); if (f && Object.keys(f).length) setErrors(f); else toast.error('No se pudo crear la cuenta.'); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); invite.mutate(); };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input label="Correo" type="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nombre" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} error={errors.first_name} required />
        <Input label="Apellidos" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="st-role">Rol</label>
        <select id="st-role" className="input-field min-h-[44px]" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffUser['role'] })}>
          <option value="staff">Personal (analítica, consulta)</option>
          <option value="admin">Administrador (todo el portal)</option>
        </select>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
        <Button type="submit" loading={invite.isPending} className="min-h-[44px]"><UserCog className="h-4 w-4" aria-hidden="true" /> Crear cuenta</Button>
      </div>
    </form>
  );
}

function RevealModal({ data, onClose }: { data: { user: StaffUser; password: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!data) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(data.password); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { toast.error('No se pudo copiar.'); }
  };
  return (
    <Modal open onClose={onClose} title="Contraseña temporal" maxWidth={460}>
      <p className="text-sm text-muted">Entregue este acceso a <strong>{data.user.email}</strong>. No se volverá a mostrar.</p>
      <div className="rounded-2xl bg-cream/70 p-4 text-center"><code className="select-all break-all font-mono text-xl font-bold text-ink">{data.password}</code></div>
      <Button variant="secondary" className="w-full" onClick={copy}>{copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />} Copiar</Button>
      <Button className="w-full" onClick={onClose}>Listo</Button>
    </Modal>
  );
}
