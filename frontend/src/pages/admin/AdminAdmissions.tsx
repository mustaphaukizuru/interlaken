import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import { ClipboardList, GraduationCap, Search, Send, Copy, X } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { TableSkeleton } from '@/components/ui/TableSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { RegistrationReviewModal } from '@/components/admin/RegistrationReviewModal';
import { api, admissionsAdminApi } from '@/services/api';
import { toPaged, ADMIN_PAGE_SIZE } from '@/lib/pagination';
import { STATUS_BADGE } from '@/lib/admissionsStatus';

interface PreReg {
  id: number;
  child_name: string;
  level: string;
  grade_applying: string;
  parent_name: string;
  parent_email: string;
  parent_phone: string;
  status: string;
  created_at: string;
}

const statusMeta: Record<string, { label: string; variant: any }> = {
  pending:   { label: 'Pendiente',  variant: 'warning' },
  contacted: { label: 'Contactado', variant: 'info' },
  enrolled:  { label: 'Inscrito',   variant: 'success' },
  rejected:  { label: 'Rechazado',  variant: 'error' },
};

async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export default function AdminAdmissions() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [invitedLink, setInvitedLink] = useState<{ name: string; url: string } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-preregistrations', page],
    queryFn: async () => toPaged<PreReg>((await api.get('/admissions/pre-register/', { params: { page } })).data),
    placeholderData: keepPreviousData,
  });

  const qc = useQueryClient();
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.patch(`/admissions/pre-register/${id}/`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-preregistrations'] });
      toast.success('Estado actualizado.');
    },
    onError: () => toast.error('No se pudo actualizar el estado.'),
  });

  const invite = useMutation({
    mutationFn: ({ id }: { id: number; name: string }) => admissionsAdminApi.invitePreRegistration(id),
    onSuccess: async ({ data: res }, { name }) => {
      const url = res.invite_url as string;
      const copied = await copyToClipboard(url);
      setInvitedLink({ name, url });
      qc.invalidateQueries({ queryKey: ['admin-preregistrations'] });
      toast.success(copied ? 'Invitación generada. Enlace copiado.' : 'Invitación generada.');
    },
    onError: () => toast.error('No se pudo generar la invitación.'),
  });

  const preRegs = data?.results;
  const count = data?.count ?? 0;

  const filtered = preRegs?.filter((p) =>
    !search ||
    p.child_name.toLowerCase().includes(search.toLowerCase()) ||
    p.parent_name.toLowerCase().includes(search.toLowerCase()) ||
    p.parent_email.toLowerCase().includes(search.toLowerCase())
  );

  const invitingId = invite.isPending ? invite.variables?.id : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-fluid-xl font-bold text-ink">Admisiones</h1>
        <p className="text-muted text-sm mt-0.5">Pre-registros e inscripciones recibidas.</p>
      </div>

      <Card title="Pre-registros">
        {invitedLink && (
          <div className="mb-4 rounded-xl2 border border-brand-600/25 bg-brand-50 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  Invitación generada{invitedLink.name ? ` para ${invitedLink.name}` : ''}
                </p>
                <p className="mt-1 break-all text-xs text-muted">{invitedLink.url}</p>
                <p className="mt-1 text-xs text-subtle">También se envió por correo al tutor. Comparta el enlace por WhatsApp si lo prefiere.</p>
              </div>
              <button type="button" onClick={() => setInvitedLink(null)} aria-label="Descartar"
                className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-subtle hover:bg-white hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
            <button type="button" onClick={() => copyToClipboard(invitedLink.url).then((ok) => ok && toast.success('Enlace copiado.'))}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-600/20 hover:bg-brand-50">
              <Copy className="h-3.5 w-3.5" /> Copiar enlace
            </button>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
          <input
            className="input-field pl-9"
            placeholder="Buscar por nombre, correo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="mb-4 text-xs text-subtle">La búsqueda filtra la página actual.</p>

        {isLoading ? (
          <TableSkeleton />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : !filtered?.length ? (
          <EmptyState
            icon={ClipboardList}
            title={search ? 'Sin resultados' : 'Sin pre-registros'}
            description={search ? 'Ningún pre-registro coincide con la búsqueda.' : 'Los pre-registros aparecerán aquí cuando se reciban.'}
          />
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <ul className="space-y-3 md:hidden">
              {filtered.map((p) => {
                const meta = statusMeta[p.status] ?? statusMeta.pending;
                return (
                  <li key={p.id} className="rounded-xl2 border border-line p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{p.child_name}</p>
                        <p className="text-xs text-subtle">Grado: {p.grade_applying}</p>
                      </div>
                      <StatusSelect value={p.status} variant={meta.variant} disabled={updateStatus.isPending} onChange={(status) => updateStatus.mutate({ id: p.id, status })} />
                    </div>
                    <dl className="mt-3 space-y-1 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Tutor</dt>
                        <dd className="text-ink text-right">{p.parent_name}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Correo</dt>
                        <dd className="text-ink text-right break-all">{p.parent_email}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Teléfono</dt>
                        <dd className="text-ink text-right">{p.parent_phone}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Fecha</dt>
                        <dd className="text-subtle text-right">{format(new Date(p.created_at), 'd MMM yyyy', { locale: es })}</dd>
                      </div>
                    </dl>
                    <button type="button" disabled={invitingId === p.id}
                      onClick={() => invite.mutate({ id: p.id, name: p.child_name })}
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-purple/10 px-3 py-2 text-xs font-semibold text-purple hover:bg-purple/15 disabled:opacity-50">
                      <Send className="h-3.5 w-3.5" /> {invitingId === p.id ? 'Generando…' : 'Invitar a inscripción'}
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: dense table */}
            <div className="admin-table-wrap hidden md:block">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Alumno</th>
                    <th>Grado</th>
                    <th>Tutor</th>
                    <th>Contacto</th>
                    <th>Fecha</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const meta = statusMeta[p.status] ?? statusMeta.pending;
                    return (
                      <tr key={p.id}>
                        <td className="font-medium text-ink">{p.child_name}</td>
                        <td className="text-muted">{p.grade_applying}</td>
                        <td className="text-muted">{p.parent_name}</td>
                        <td>
                          <div className="text-muted">{p.parent_email}</div>
                          <div className="text-subtle text-xs">{p.parent_phone}</div>
                        </td>
                        <td className="text-subtle whitespace-nowrap">
                          {format(new Date(p.created_at), 'd MMM yyyy', { locale: es })}
                        </td>
                        <td>
                          <StatusSelect value={p.status} variant={meta.variant} disabled={updateStatus.isPending} onChange={(status) => updateStatus.mutate({ id: p.id, status })} />
                        </td>
                        <td>
                          <button type="button" disabled={invitingId === p.id}
                            onClick={() => invite.mutate({ id: p.id, name: p.child_name })}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-purple/10 px-2.5 py-1 text-xs font-semibold text-purple hover:bg-purple/15 disabled:opacity-50 whitespace-nowrap">
                            <Send className="h-3.5 w-3.5" /> {invitingId === p.id ? 'Generando…' : 'Invitar'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="pre-registros" />
      </Card>

      <RegistrationsSection />
    </div>
  );
}

const VARIANT_CLASS: Record<string, string> = {
  warning: 'border-amber/40 text-amber',
  info:    'border-purple/40 text-purple',
  success: 'border-green/50 text-green-dark',
  error:   'border-coral/50 text-coral-dark',
};

/** Inline status control — moves a pre-registration through the pipeline. */
function StatusSelect({ value, variant, onChange, disabled }: {
  value: string; variant: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Cambiar estado del pre-registro"
      className={`rounded-lg border bg-white px-2 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-50 ${VARIANT_CLASS[variant] ?? 'border-line text-muted'}`}
    >
      {Object.entries(statusMeta).map(([k, m]) => (
        <option key={k} value={k}>{m.label}</option>
      ))}
    </select>
  );
}

// ── Inscripciones (full enrollment records) — review + document verification ──
interface RegRow {
  id: number; child_name: string; grade_applying: string; cycle: string;
  parent1_name: string; parent1_email: string; parent1_phone: string;
  status: string; submitted_at: string | null; created_at: string;
  doc_count: number; doc_verified: number;
}

function RegistrationsSection() {
  const [page, setPage] = useState(1);
  const [reviewId, setReviewId] = useState<number | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-registrations', page],
    queryFn: async () => toPaged<RegRow>((await admissionsAdminApi.listRegistrations(page)).data),
    placeholderData: keepPreviousData,
  });

  const rows = data?.results;
  const count = data?.count ?? 0;

  return (
    <Card title="Inscripciones" subtitle="Expedientes de inscripción para revisión y verificación de documentos.">
      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !rows?.length ? (
        <EmptyState
          icon={GraduationCap}
          title="Sin inscripciones"
          description="Las inscripciones enviadas por las familias aparecerán aquí para su revisión."
        />
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <ul className="space-y-3 md:hidden">
            {rows.map((r) => {
              const meta = STATUS_BADGE[r.status] ?? STATUS_BADGE.draft;
              return (
                <li key={r.id} className="rounded-xl2 border border-line p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{r.child_name}</p>
                      <p className="text-xs text-subtle">{r.grade_applying} · Ciclo {r.cycle}</p>
                    </div>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </div>
                  <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Tutor</dt>
                      <dd className="text-ink text-right">{r.parent1_name}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Documentos</dt>
                      <dd className="text-ink text-right">{r.doc_verified}/{r.doc_count} verificados</dd>
                    </div>
                  </dl>
                  <button type="button" onClick={() => setReviewId(r.id)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cream px-3 py-2 text-xs font-semibold text-ink hover:bg-line">
                    Revisar expediente
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Desktop: dense table */}
          <div className="admin-table-wrap hidden md:block">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Grado</th>
                  <th>Tutor</th>
                  <th>Docs</th>
                  <th>Estado</th>
                  <th>Enviada</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = STATUS_BADGE[r.status] ?? STATUS_BADGE.draft;
                  return (
                    <tr key={r.id}>
                      <td className="font-medium text-ink">{r.child_name}</td>
                      <td className="text-muted">{r.grade_applying}</td>
                      <td>
                        <div className="text-muted">{r.parent1_name}</div>
                        <div className="text-subtle text-xs">{r.parent1_email}</div>
                      </td>
                      <td className="text-muted whitespace-nowrap">{r.doc_verified}/{r.doc_count}</td>
                      <td><Badge variant={meta.variant}>{meta.label}</Badge></td>
                      <td className="text-subtle whitespace-nowrap">
                        {r.submitted_at ? format(new Date(r.submitted_at), 'd MMM yyyy', { locale: es }) : '—'}
                      </td>
                      <td>
                        <button type="button" onClick={() => setReviewId(r.id)}
                          className="rounded-lg bg-cream px-2.5 py-1 text-xs font-semibold text-ink hover:bg-line">
                          Revisar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} count={count} onChange={setPage} itemLabel="inscripciones" />

      <RegistrationReviewModal id={reviewId} open={reviewId != null} onClose={() => setReviewId(null)} />
    </Card>
  );
}
