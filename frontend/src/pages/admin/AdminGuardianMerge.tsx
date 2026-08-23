import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Merge } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { portalApi, type MergePreview, type MergeResult } from '@/services/api';
import { apiErrors } from '@/cms/editor/helpers';

/** /admin/fusionar-cuentas — merge two parent accounts (BACKLOG P4-6). */
export default function AdminGuardianMerge() {
  const qc = useQueryClient();
  const [keep, setKeep] = useState('');
  const [drop, setDrop] = useState('');
  const [confirm, setConfirm] = useState('');
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState('');
  const load = useMutation({
    mutationFn: () => portalApi.guardianMergePreview(keep.trim(), drop.trim()),
    onSuccess: ({ data }) => { setPreview(data); setResult(null); setError(''); },
    onError: (e) => { setPreview(null); setError(apiErrors(e).detail || 'No se pudo cargar la vista previa.'); },
  });
  const run = useMutation({
    mutationFn: () => portalApi.guardianMerge({ keep: preview!.keep.id, drop: preview!.drop.id, confirm }),
    onSuccess: ({ data }) => { setResult(data); setPreview(null); setConfirm(''); toast.success('Cuentas fusionadas.'); qc.invalidateQueries({ queryKey: ['admin-students'] }); },
    onError: (e) => { const f = apiErrors(e); setError(f.detail || f.confirm || 'No se pudo fusionar.'); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); load.mutate(); };
  const movedTotal = result ? Object.values(result.moved).reduce((a, b) => a + b, 0) : 0;
  const skippedTotal = result ? Object.values(result.skipped).reduce((a, b) => a + b, 0) : 0;

  return (
    <>
      <PageHeader title="Fusionar cuentas de familia" subtitle="Cuando una familia tiene dos cuentas (por ejemplo Gmail y un correo invitado), conserve una y mueva a ella hijos, notificaciones, pagos y demás. La otra queda desactivada, nunca se borra." />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card>
          <form onSubmit={submit} className="space-y-3">
            <Input label="Cuenta que se conserva (correo)" value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="mama@gmail.com" required />
            <Input label="Cuenta que se fusiona y desactiva (correo)" value={drop} onChange={(e) => setDrop(e.target.value)} placeholder="mama@hotmail.com" required />
            {error && <p className="text-sm text-coral-600" role="alert">{error}</p>}
            <Button type="submit" loading={load.isPending}><Merge size={16} aria-hidden="true" /> Ver qué se movería</Button>
          </form>
        </Card>
        <Card>
          {result ? (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-green-600" aria-hidden="true" />
              <div>
                <h2 className="font-head text-lg font-bold text-ink">Fusión completada</h2>
                <p className="mt-1 text-sm text-muted">{movedTotal} referencias movidas{skippedTotal ? `, ${skippedTotal} omitidas por duplicado (p. ej. comunicados ya leídos por ambas cuentas)` : ''}. La cuenta fusionada quedó desactivada. Registro en Auditoría.</p>
              </div>
            </div>
          ) : preview ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {([['Se conserva', preview.keep, 'success'], ['Se fusiona', preview.drop, 'warning']] as const).map(([label, u, tone]) => (
                  <div key={u.id} className="rounded-xl border border-line p-3 text-sm">
                    <Badge variant={tone}>{label}</Badge>
                    <p className="mt-2 font-semibold text-ink">{u.full_name}</p>
                    <p className="text-subtle">{u.email}{u.phone ? ` · ${u.phone}` : ''}</p>
                    <p className="mt-1 text-xs text-subtle">{u.google ? 'Google' : 'Contraseña'}{u.last_login ? ` · último acceso ${new Date(u.last_login).toLocaleDateString('es-MX')}` : ' · nunca ha entrado'}</p>
                    <ul className="mt-2 space-y-0.5 text-xs text-muted">{u.children.length === 0 ? <li>Sin hijos vinculados</li> : u.children.map((c) => <li key={c.id}>{c.name} · {c.grade}</li>)}</ul>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-ink">Se moverán</h3>
                {Object.keys(preview.references).length === 0 ? <p className="text-sm text-muted">Solo los hijos vinculados.</p> : (
                  <ul className="mt-1 grid gap-1 text-xs text-muted sm:grid-cols-2">{Object.entries(preview.references).map(([k, n]) => <li key={k}>{k.split('.')[1]}: {n}</li>)}</ul>
                )}
              </div>
              <Input label="Escriba FUSIONAR para confirmar" value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} />
              <Button variant="danger" onClick={() => run.mutate()} loading={run.isPending} disabled={confirm !== 'FUSIONAR'}>Fusionar cuentas</Button>
            </div>
          ) : <p className="text-sm text-muted">Indique los dos correos y revise la vista previa antes de fusionar.</p>}
        </Card>
      </div>
    </>
  );
}
