import { Fragment, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCog, Plus, KeyRound, Copy, Check, FileUp, UserX, UserCheck, ShieldCheck, Pencil, History } from 'lucide-react';
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
import { RowActionsMenu, type RowMenuItem } from '@/components/admin/RowActionsMenu';
import { AuditTimeline } from '@/components/admin/AuditTimeline';
import { ARCHIVE_ACTION, DELETE_ACTION, RESTORE_ACTION, removalPlanNote } from '@/components/admin/studentActions';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUrlFilters, useUrlPage } from '@/hooks/useUrlFilters';
import { useRowSelection } from '@/hooks/useRowSelection';
import { adminKeys } from '@/hooks/queries/keys';
import { STAFF_ENTITY, staffImportApi, useStaffBulk, useStaffExport, useStaffList, type StaffListParams } from '@/hooks/queries/staff';
import { useAuthStore } from '@/store/authStore';
import { portalApi, type StaffUser } from '@/services/api';
import { idsParam, type BulkActionDef, type ExportFormat } from '@/services/dataOps';
import { apiErrorMessage, fieldErrorsOrNull } from '@/lib/apiErrors';
import { StaffAccessFields, StaffAccessModal, StaffAccessSummary, type StaffAccess } from '@/components/admin/StaffAccessFields';
import { PUESTOS } from '@/lib/areaCatalog';

const ROLE: Record<string, string> = { admin: 'Administrador', staff: 'Personal' };
const ROLE_OPTIONS = Object.entries(ROLE).map(([value, label]) => ({ value, label }));
/** Archived accounts are off every other tab; this one lists only them, with Restaurar. */
const ARCHIVED = 'archivadas';
const IMPORT_HEADERS = [{ key: 'correo', required: true }, { key: 'nombre', required: true }, { key: 'apellidos' }, { key: 'rol' }, { key: 'puesto' }];
const DEACTIVATE: BulkActionDef = { name: 'deactivate', label: 'Desactivar', danger: true, icon: UserX, planVerb: 'Se desactivarán' };
const REACTIVATE: BulkActionDef = { name: 'reactivate', label: 'Reactivar', icon: UserCheck, planVerb: 'Se reactivarán' };
const ROW_ACTION_BASE =
  'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-[36px]';
const ROW_ACTION = `${ROW_ACTION_BASE} text-purple hover:bg-cream-2`;
// One color class each: with both, Tailwind's own order (not the class string) picks the winner.
const ROW_ACTION_DANGER = `${ROW_ACTION_BASE} text-coral-700 hover:bg-coral-50`;

/**
 * /admin/usuarios — staff accounts on the Data Ops UI foundation (BACKLOG P1-H1):
 * search, rol/activo filters in the URL, sort on every column, selection with
 * bulk deactivate / reactivate / archive / restore / delete (per-row guards on
 * the server), export of the view, import = invite many. Each row edits name and
 * email, and its activity panel shows the account's last actions in Auditoría.
 * Archivar takes an account off the list (Archivadas, Restaurar); Eliminar
 * erases an account never used and archives the rest.
 */
export default function AdminStaffUsers() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [toToggle, setToToggle] = useState<StaffUser | null>(null);
  const [toReset, setToReset] = useState<StaffUser | null>(null);
  const [toAccess, setToAccess] = useState<StaffUser | null>(null);
  const [revealed, setRevealed] = useState<{ user: StaffUser; password: string } | null>(null);
  const [confirming, setConfirming] = useState<{ action: BulkActionDef; one?: StaffUser } | null>(null);
  const [toEdit, setToEdit] = useState<StaffUser | null>(null);
  const [toView, setToView] = useState<StaffUser | null>(null);
  const isLg = useMediaQuery('(min-width: 1024px)');

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
  const { data: archivedList } = useStaffList({ page: 1, page_size: 1, active: ARCHIVED });
  const archivedCount = archivedList?.count ?? 0;
  const viewingArchived = filters.active === ARCHIVED;
  const activeTabs = [
    { value: '1', label: 'Activas' },
    { value: '0', label: 'Inactivas' },
    { value: ARCHIVED, label: 'Archivadas', count: archivedCount },
  ];
  const bulkActions = viewingArchived ? [RESTORE_ACTION, DELETE_ACTION] : [DEACTIVATE, REACTIVATE, ARCHIVE_ACTION, DELETE_ACTION];
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
        <span className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setToView(u)}
            className="rounded text-left font-medium text-ink hover:text-purple hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
            aria-label={`Ver la cuenta y la actividad de ${u.full_name || u.email}`}
          >
            {u.full_name || u.email}
          </button>
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
      id: 'access', header: 'Puesto y áreas', minWidth: 220,
      cell: (u) => <StaffAccessSummary user={u} />,
    },
    {
      id: 'is_active', header: 'Estado', sortKey: 'is_active', minWidth: 100,
      cell: (u) => (u.archived_at
        ? <Badge variant="neutral">Archivada</Badge>
        : <Badge variant={u.is_active ? 'success' : 'neutral'}>{u.is_active ? 'Activa' : 'Inactiva'}</Badge>),
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
  const managed = (u: StaffUser) => !u.is_superuser && u.id !== me?.id;
  const menuItems = (u: StaffUser): RowMenuItem[] => {
    const items: RowMenuItem[] = [{ key: 'activity', label: 'Ver actividad', icon: History, onSelect: () => setToView(u) }];
    if (!managed(u)) return items;
    if (u.archived_at) {
      items.push({ key: 'restore', label: 'Restaurar', icon: RESTORE_ACTION.icon, onSelect: () => setConfirming({ action: RESTORE_ACTION, one: u }) });
    } else {
      // Admin passwords are never generated by a peer admin (the API refuses with 403):
      // each admin uses their own password flow, a superuser restores lost access.
      if (u.role !== 'admin') {
        items.push({ key: 'password', label: 'Generar contraseña', icon: KeyRound, onSelect: () => setToReset(u) });
      }
      items.push(
        { key: 'toggle', label: u.is_active ? 'Desactivar' : 'Reactivar', icon: u.is_active ? UserX : UserCheck, onSelect: () => setToToggle(u) },
        { key: 'archive', label: 'Archivar', icon: ARCHIVE_ACTION.icon, onSelect: () => setConfirming({ action: ARCHIVE_ACTION, one: u }) },
      );
    }
    items.push({ key: 'delete', label: 'Eliminar', icon: DELETE_ACTION.icon, danger: true, onSelect: () => setConfirming({ action: DELETE_ACTION, one: u }) });
    return items;
  };

  return (
    <>
      <PageHeader
        title="Usuarios del personal"
        subtitle="Administradores (todo el portal) y personal con su puesto: Secretaría, Recepción, Cafetería o áreas a la medida. Las cuentas superusuario se gestionan en el panel técnico."
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
      <Card title={`${count.toLocaleString('es-MX')} ${count === 1 ? 'cuenta' : 'cuentas'}`}>
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
          pinActions
          rowActions={(u) => (
            <>
              {managed(u) && !u.archived_at && (
                <>
                  <button type="button" className={ROW_ACTION} onClick={() => setToEdit(u)} aria-label={`Editar ${u.email}`}>
                    <Pencil className="h-4 w-4" aria-hidden="true" /> Editar
                  </button>
                  {u.role === 'staff' && (
                    <button type="button" className={ROW_ACTION} onClick={() => setToAccess(u)} aria-label={`Puesto y áreas de ${u.email}`}>
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Acceso
                    </button>
                  )}
                </>
              )}
              {isLg ? (
                <RowActionsMenu label={`Más acciones para ${u.email}`} items={menuItems(u)} />
              ) : menuItems(u).map((it) => {
                const Icon = it.icon!;
                return (
                  <Fragment key={it.key}>
                    {it.danger && <div role="separator" className="my-0.5 h-px bg-line" />}
                    <button type="button" onClick={it.onSelect} aria-label={`${it.label} ${u.email}`}
                      className={`${it.danger ? ROW_ACTION_DANGER : ROW_ACTION} w-full justify-start`}>
                      <Icon className="h-4 w-4" aria-hidden="true" /> {it.label}
                    </button>
                  </Fragment>
                );
              })}
            </>
          )}
          toolbar={(
            <FilterBar
              search={{ placeholder: 'Buscar por nombre o correo…', label: 'Buscar usuarios' }}
              tabs={{ paramKey: 'activo', options: activeTabs, allLabel: 'Todas', label: 'Filtrar por estado' }}
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
              actions={bulkActions}
              inline={4}
              onAction={(action) => setConfirming({ action })}
              busy={bulk.isPending}
              exportMenu={<ExportMenu label="Exportar seleccionadas" filenamePrefix="usuarios" selectedCount={selection.count} forceSelected fetch={fetchExport} />}
            />
          )}
          empty={{
            icon: UserCog,
            title: viewingArchived ? 'No hay cuentas archivadas' : anyFilter ? 'Sin resultados' : 'Sin cuentas',
            description: viewingArchived
              ? 'Las cuentas que archive aparecerán aquí, con la opción de restaurarlas.'
              : anyFilter ? 'Ninguna cuenta coincide con los filtros.' : 'Invite al personal para que aparezca aquí.',
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
        description={<>Una fila por persona. <code>rol</code>: <em>staff</em> (Personal) o <em>admin</em>. <code>puesto</code> (opcional, solo Personal): <em>secretaria</em>, <em>recepcion</em> o <em>cafeteria</em> da las áreas de ese puesto. Las cuentas se crean sin contraseña: la persona entra con Google o, si es Personal, usted genera una con «Contraseña» (las cuentas de administrador usan su propio flujo de recuperación).</>}
      />
      <BulkConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        action={confirming?.action ?? null}
        payload={confirming?.action.payload}
        entityLabel="cuentas"
        ids={confirming?.one ? [confirming.one.id] : selection.ids}
        allMatching={confirming?.one ? false : selection.allMatching}
        subject={confirming?.one?.email}
        filters={filters}
        execute={(body) => bulk.mutateAsync(body)}
        renderPlan={removalPlanNote(confirming?.action, 'staff')}
        onDone={(r) => { if (!r.failed.length) selection.onClear(); }}
      />
      <EditStaffModal user={toEdit} onClose={() => setToEdit(null)} onSaved={invalidate} />
      <StaffActivityModal user={toView} onClose={() => setToView(null)} />

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
      <StaffAccessModal user={toAccess} onClose={() => setToAccess(null)} onSaved={invalidate} />
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
  // A new staff account starts as Secretaría; the admin changes it here.
  const [access, setAccess] = useState<StaffAccess>({ staff_title: PUESTOS[0].label, staff_areas: [...PUESTOS[0].areas] });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const invite = useMutation({
    mutationFn: () => portalApi.inviteStaff(form.role === 'staff' ? { ...form, ...access } : form),
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
          <option value="staff">Personal (solo las áreas de su puesto)</option>
          <option value="admin">Administrador (todo el portal)</option>
        </select>
      </div>
      {form.role === 'staff' && <StaffAccessFields value={access} onChange={setAccess} idPrefix="invite" />}
      {errors.staff_areas && <p className="text-xs text-coral">{errors.staff_areas}</p>}
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

/** Name and email; the email is also the address the person signs in with through Google. */
function EditStaffModal({ user, onClose, onSaved }: { user: StaffUser | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal open={!!user} onClose={onClose} title="Editar cuenta" maxWidth={480}>
      {user && <EditStaffForm key={user.id} user={user} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function EditStaffForm({ user, onClose, onSaved }: { user: StaffUser; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ first_name: user.first_name, last_name: user.last_name, email: user.email });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const save = useMutation({
    mutationFn: () => portalApi.updateStaff(user.id, form),
    onSuccess: () => { onSaved(); toast.success('Cuenta actualizada.'); onClose(); },
    onError: (e: unknown) => {
      const f = fieldErrorsOrNull(e);
      if (f && Object.keys(f).length) setErrors(f);
      else toast.error(apiErrorMessage(e, 'No se pudo guardar.'));
    },
  });
  const field = (k: keyof typeof form) => ({
    value: form[k],
    error: errors[k],
    onChange: (e: { target: { value: string } }) => { setForm({ ...form, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim()) { setErrors({ first_name: 'Requerido.' }); return; }
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nombre" autoComplete="off" required {...field('first_name')} />
        <Input label="Apellidos" autoComplete="off" {...field('last_name')} />
      </div>
      <Input label="Correo" type="email" inputMode="email" autoComplete="off" required hint="También es el correo con el que entra con «Continuar con Google»." {...field('email')} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
        <Button type="submit" loading={save.isPending} className="min-h-[44px]">Guardar cambios</Button>
      </div>
    </form>
  );
}

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Nunca');

/** The account at a glance and what it did lately (Auditoría rows where it is the actor). */
function StaffActivityModal({ user, onClose }: { user: StaffUser | null; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', STAFF_ENTITY, 'activity', user?.id],
    queryFn: async () => (await portalApi.getStaffActivity(user!.id)).data,
    enabled: !!user,
  });
  const u = data?.user ?? user;
  return (
    <Modal open={!!user} onClose={onClose} title={u?.full_name || u?.email || 'Cuenta'} maxWidth={560}>
      {u && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-cream-2 p-4 text-sm">
          <div className="col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Correo</dt><dd className="mt-0.5 break-all text-ink">{u.email}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Rol</dt><dd className="mt-0.5 text-ink">{ROLE[u.role] ?? u.role}{u.staff_title ? ` · ${u.staff_title}` : ''}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Estado</dt><dd className="mt-0.5 text-ink">{u.archived_at ? 'Archivada' : u.is_active ? 'Activa' : 'Inactiva'}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Último acceso</dt><dd className="mt-0.5 text-ink">{fmtDate(u.last_login)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Alta</dt><dd className="mt-0.5 text-ink">{fmtDate(u.date_joined)}</dd></div>
        </dl>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-head text-sm font-semibold text-ink">Actividad reciente</h3>
        {data && data.total_actions > 0 && <span className="text-xs text-subtle">{data.total_actions.toLocaleString('es-MX')} {data.total_actions === 1 ? 'acción' : 'acciones'} en total</span>}
      </div>
      {isLoading ? <LoadingSpinner /> : isError || !data ? <ErrorState onRetry={() => refetch()} /> : (
        <AuditTimeline entries={data.recent} showActor={false} empty="Esta cuenta todavía no ha hecho cambios en el portal." />
      )}
      {data && data.total_actions > data.recent.length && u && (
        <Link to={`/admin/auditoria?actor=${encodeURIComponent(u.email)}`} onClick={onClose} className="inline-flex text-sm font-semibold text-purple hover:underline">
          Ver todas en Auditoría
        </Link>
      )}
    </Modal>
  );
}

