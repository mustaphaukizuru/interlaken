import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { UserCog, Plus, KeyRound, Copy, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pagination } from '@/components/ui/Pagination';
import { ADMIN_PAGE_SIZE } from '@/lib/pagination';
import { useUrlPage } from '@/hooks/useUrlFilters';
import { useAuthStore } from '@/store/authStore';
import { portalApi, type StaffUser } from '@/services/api';
import { fieldErrorsFrom } from '@/components/admin/StudentFormModal';

const ROLE: Record<string, string> = { admin: 'Administrador', staff: 'Personal' };

/** /admin/usuarios — staff accounts: invite, role, deactivate, reset password (BACKLOG P1-H1). */
export default function AdminStaffUsers() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toToggle, setToToggle] = useState<StaffUser | null>(null);
  const [toReset, setToReset] = useState<StaffUser | null>(null);
  const [revealed, setRevealed] = useState<{ user: StaffUser; password: string } | null>(null);

  const [page, setPage] = useUrlPage();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-staff', page],
    queryFn: async () => (await portalApi.listStaff(page)).data,
    placeholderData: keepPreviousData,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-staff'] });
  const onErr = (e: unknown) => {
    const d = (e as { response?: { data?: { detail?: string } } })?.response?.data;
    toast.error(d?.detail ?? 'No se pudo guardar.');
  };
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

  const rows = data?.results ?? [];

  return (
    <>
      <PageHeader
        title="Usuarios del personal"
        subtitle="Cuentas de administración y personal del portal. Las cuentas superusuario se gestionan en el panel técnico."
        actions={<Button onClick={() => setInviteOpen(true)}><Plus size={16} aria-hidden="true" /> Invitar</Button>}
      />
      <Card title={`${data?.count ?? 0} cuentas`}>
        {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading ? <ListSkeleton /> : (
          <ul className="divide-y divide-cream">
            {rows.map((u) => {
              const self = u.id === me?.id;
              return (
                <li key={u.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      {u.full_name || u.email}
                      <Badge variant={u.role === 'admin' ? 'info' : 'neutral'}>{ROLE[u.role] ?? u.role}</Badge>
                      {!u.is_active && <Badge variant="neutral">Inactivo</Badge>}
                      {u.is_superuser && <Badge variant="warning">Superusuario</Badge>}
                      {self && <span className="text-xs text-subtle">(usted)</span>}
                    </p>
                    <p className="text-xs text-subtle">
                      {u.email} · último acceso {u.last_login ? new Date(u.last_login).toLocaleDateString('es-MX') : 'nunca'}
                    </p>
                  </div>
                  {!u.is_superuser && (
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <select
                        aria-label={`Rol de ${u.email}`}
                        className="input-field min-h-[36px] w-auto py-1 text-xs"
                        value={u.role}
                        disabled={self || patch.isPending}
                        onChange={(e) => patch.mutate({ id: u.id, data: { role: e.target.value as StaffUser['role'] } })}
                      >
                        <option value="admin">Administrador</option>
                        <option value="staff">Personal</option>
                      </select>
                      <Button size="sm" variant="ghost" onClick={() => setToReset(u)} disabled={self}>
                        <KeyRound className="h-4 w-4" aria-hidden="true" /> Contraseña
                      </Button>
                      <Button size="sm" variant={u.is_active ? 'ghost' : 'secondary'} onClick={() => setToToggle(u)} disabled={self}>
                        {u.is_active ? 'Desactivar' : 'Reactivar'}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={data?.count ?? 0} onChange={setPage} itemLabel="cuentas" />
      </Card>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={(r) => { invalidate(); setRevealed(r); }} />

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
    onError: (e: unknown) => { const f = fieldErrorsFrom(e); if (f) setErrors(f as Record<string, string>); else toast.error('No se pudo crear la cuenta.'); },
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
