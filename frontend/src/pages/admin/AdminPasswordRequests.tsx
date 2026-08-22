import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Check, Copy, MessageCircle, Mail, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { portalApi, type PasswordRequest, type PasswordRequestResolved } from '@/services/api';
import { mailtoDeliveryHref, whatsappDeliveryHref } from '@/lib/credentialTemplates';

const CHANNEL: Record<string, string> = { whatsapp: 'WhatsApp', email: 'Correo', phone: 'Teléfono', in_person: 'Presencial' };
const STATUS: Record<string, { label: string; variant: 'warning' | 'success' | 'neutral' }> = {
  open: { label: 'Pendiente', variant: 'warning' },
  resolved: { label: 'Resuelta', variant: 'success' },
  rejected: { label: 'Rechazada', variant: 'neutral' },
};

/**
 * /admin/contrasenas — password request inbox (BACKLOG P1-A4).
 * Families cannot reset their own password; every WhatsApp/email/phone
 * request is logged here and resolved by generating a password once.
 */
export default function AdminPasswordRequests() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'resolved' | 'rejected' | ''>('open');
  const [logOpen, setLogOpen] = useState(false);
  const [toReject, setToReject] = useState<PasswordRequest | null>(null);
  const [toResolve, setToResolve] = useState<PasswordRequest | null>(null);
  const [resolved, setResolved] = useState<PasswordRequestResolved | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['password-requests', status],
    queryFn: async () => (await portalApi.getPasswordRequests(status || undefined)).data,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['password-requests'] });

  const reject = useMutation({
    mutationFn: (r: PasswordRequest) => portalApi.updatePasswordRequest(r.id, { action: 'reject' }),
    onSuccess: () => { toast.success('Solicitud rechazada.'); setToReject(null); invalidate(); },
    onError: () => toast.error('No se pudo rechazar.'),
  });
  const resolve = useMutation({
    mutationFn: (r: PasswordRequest) =>
      portalApi.updatePasswordRequest(r.id, { action: 'resolve', delivered_via: r.channel }),
    onSuccess: ({ data }) => { setToResolve(null); setResolved(data as PasswordRequestResolved); invalidate(); },
    onError: (e: unknown) => {
      const d = (e as { response?: { data?: { detail?: string; user?: string[] } } })?.response?.data;
      toast.error(d?.user?.[0] ?? d?.detail ?? 'No se pudo resolver la solicitud.');
    },
  });

  const rows = data?.results ?? [];

  return (
    <>
      <PageHeader
        title="Solicitudes de contraseña"
        subtitle="Las familias piden su contraseña por WhatsApp o correo; aquí se registra y se resuelve cada solicitud."
        actions={(
          <Button onClick={() => setLogOpen(true)}><Plus size={16} aria-hidden="true" /> Registrar solicitud</Button>
        )}
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filtrar por estado">
        {([['open', 'Pendientes'], ['resolved', 'Resueltas'], ['rejected', 'Rechazadas'], ['', 'Todas']] as const).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={status === v}
            onClick={() => setStatus(v)}
            className={`min-h-[40px] rounded-full px-4 text-sm font-semibold transition-colors ${status === v ? 'bg-purple text-white' : 'bg-white text-muted hover:text-ink border border-line'}`}
          >
            {label}{v === 'open' && data?.open_count ? ` (${data.open_count})` : ''}
          </button>
        ))}
      </div>

      <Card>
        {isError ? <ErrorState onRetry={() => refetch()} />
          : isLoading ? <ListSkeleton />
          : !rows.length ? (
            <EmptyState icon={KeyRound} title="Sin solicitudes" description="Registre una solicitud cuando una familia pida su contraseña." />
          ) : (
            <ul className="divide-y divide-cream">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {r.user_name || r.requester_name || r.requested_email}
                      {r.user ? '' : <span className="ml-2 text-xs text-coral-600">(sin cuenta vinculada)</span>}
                    </p>
                    <p className="truncate text-xs text-subtle">
                      {r.user_email || r.requested_email} · {CHANNEL[r.channel] ?? r.channel} · {new Date(r.created_at).toLocaleString('es-MX')}
                      {r.note ? ` · ${r.note}` : ''}
                      {r.resolved_by_name ? ` · atendió ${r.resolved_by_name}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={STATUS[r.status]?.variant ?? 'neutral'}>{STATUS[r.status]?.label ?? r.status}</Badge>
                    {r.status === 'open' && (
                      <>
                        <Button size="sm" onClick={() => setToResolve(r)} disabled={!r.user}>
                          <KeyRound className="h-4 w-4" aria-hidden="true" /> Generar contraseña
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setToReject(r)}>
                          <XCircle className="h-4 w-4" aria-hidden="true" /> Rechazar
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Card>

      <LogRequestModal open={logOpen} onClose={() => setLogOpen(false)} onSaved={invalidate} />

      <ConfirmDialog
        open={!!toReject}
        onClose={() => setToReject(null)}
        onConfirm={() => toReject && reject.mutate(toReject)}
        title="Rechazar solicitud"
        message="La solicitud quedará registrada como rechazada (por ejemplo, si no se pudo verificar la identidad)."
        confirmLabel="Rechazar"
        loading={reject.isPending}
      />
      <ConfirmDialog
        open={!!toResolve}
        onClose={() => setToResolve(null)}
        onConfirm={() => toResolve && resolve.mutate(toResolve)}
        title="Generar nueva contraseña"
        message={`Se generará una contraseña temporal para ${toResolve?.user_email ?? ''} y se cerrarán sus sesiones abiertas. Verifique la identidad antes de continuar.`}
        confirmLabel="Generar"
        loading={resolve.isPending}
      />

      <DeliveryModal resolved={resolved} onClose={() => setResolved(null)} />
    </>
  );
}

function LogRequestModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Registrar solicitud" maxWidth={480}>
      <LogRequestForm key={String(open)} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

function LogRequestForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => portalApi.createPasswordRequest({ requested_email: email.trim(), requester_name: name.trim(), channel, note: note.trim() }),
    onSuccess: ({ data }) => {
      toast.success(data.user ? 'Solicitud registrada.' : 'Registrada sin cuenta vinculada: verifique el correo.');
      onSaved(); onClose();
    },
    onError: () => toast.error('No se pudo registrar la solicitud.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) { setError('Correo inválido.'); return; }
    create.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input label="Correo de la cuenta" type="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} error={error} required />
      <Input label="Quién solicita" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del padre/tutor" />
      <div>
        <label className="label" htmlFor="pr-channel">Canal</label>
        <select id="pr-channel" className="input-field min-h-[44px]" value={channel} onChange={(e) => setChannel(e.target.value)}>
          {Object.entries(CHANNEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} className="min-h-[44px]">Cancelar</Button>
        <Button type="submit" loading={create.isPending} className="min-h-[44px]">Registrar</Button>
      </div>
    </form>
  );
}

function DeliveryModal({ resolved, onClose }: { resolved: PasswordRequestResolved | null; onClose: () => void }) {
  const [copied, setCopied] = useState<'pw' | 'msg' | null>(null);
  if (!resolved) return null;
  const t = resolved.templates;
  const wa = whatsappDeliveryHref(resolved.whatsapp_number, t);
  const mail = mailtoDeliveryHref(resolved.user_email, t);
  const copy = async (what: 'pw' | 'msg') => {
    try {
      await navigator.clipboard.writeText(what === 'pw' ? resolved.temporary_password : t.whatsapp_text);
      setCopied(what); setTimeout(() => setCopied(null), 1500);
    } catch { toast.error('No se pudo copiar.'); }
  };
  return (
    <Modal open onClose={onClose} title="Contraseña generada" maxWidth={520}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Envíe el acceso a <strong>{resolved.user_name || resolved.user_email}</strong> por el mismo medio en que lo pidió.
          La contraseña <strong>no se volverá a mostrar</strong>.
        </p>
        <div className="rounded-2xl bg-cream/70 p-4 text-center">
          <code className="block select-all break-all font-mono text-xl font-bold tracking-wide text-ink">{resolved.temporary_password}</code>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => copy('pw')}>
            {copied === 'pw' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />} Copiar contraseña
          </Button>
          <Button variant="secondary" onClick={() => copy('msg')}>
            {copied === 'msg' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />} Copiar mensaje
          </Button>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-secondary justify-center text-sm">
              <MessageCircle className="h-4 w-4" aria-hidden="true" /> Enviar por WhatsApp
            </a>
          )}
          <a href={mail} className="btn-outline justify-center text-sm">
            <Mail className="h-4 w-4" aria-hidden="true" /> Enviar por correo
          </a>
        </div>
        <textarea readOnly className="input-field h-40 text-xs" value={t.whatsapp_text} aria-label="Mensaje para la familia" />
        <Button className="w-full" onClick={onClose}>Listo, ya lo envié</Button>
      </div>
    </Modal>
  );
}
