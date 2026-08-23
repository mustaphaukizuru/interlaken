import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, ShieldCheck, ShieldOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { authApi, type SessionsInfo } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { apiErrors } from '@/cms/editor/helpers';

const REASON: Record<string, string> = { bad_password: 'contraseña incorrecta', totp_required: 'faltó el código', bad_totp: 'código incorrecto', inactive: 'cuenta inactiva' };

/** Mi perfil → Seguridad: login history, other sessions, TOTP for staff (BACKLOG P4-7). */
export function SecurityPanel() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const { data, isLoading } = useQuery({ queryKey: ['my-sessions'], queryFn: async () => (await authApi.sessions()).data as SessionsInfo });
  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [err, setErr] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['my-sessions'] });
  const closeOthers = useMutation({ mutationFn: () => authApi.closeOtherSessions(), onSuccess: ({ data: d }) => { toast.success(d.closed ? `${d.closed} sesiones cerradas.` : 'No había otras sesiones.'); invalidate(); }, onError: () => toast.error('No se pudo cerrar.') });
  const start = useMutation({ mutationFn: () => authApi.totpSetup(), onSuccess: ({ data: d }) => { setSetup(d); setErr(''); }, onError: (e) => setErr(apiErrors(e).detail || 'No disponible.') });
  const enable = useMutation({ mutationFn: () => authApi.totpEnable(code), onSuccess: () => { toast.success('Segundo factor activado.'); setSetup(null); setCode(''); invalidate(); }, onError: (e) => setErr(apiErrors(e).code || 'Código incorrecto.') });
  const disable = useMutation({ mutationFn: () => authApi.totpDisable(disableCode), onSuccess: () => { toast.success('Segundo factor desactivado.'); setDisableCode(''); invalidate(); }, onError: (e) => setErr(apiErrors(e).code || apiErrors(e).detail || 'Código incorrecto.') });
  const staff = role === 'admin' || role === 'staff';

  return (
    <>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-purple" aria-hidden="true" /><h2 className="font-head text-base font-semibold text-ink">Sesiones</h2></div>
          <Button size="sm" variant="secondary" onClick={() => closeOthers.mutate()} loading={closeOthers.isPending}><LogOut size={14} aria-hidden="true" /> Cerrar otras sesiones</Button>
        </div>
        {isLoading || !data ? <ListSkeleton /> : (
          <>
            <p className="mb-3 text-sm text-muted">{data.active_sessions} {data.active_sessions === 1 ? 'dispositivo con sesión abierta' : 'dispositivos con sesión abierta'}. Si no reconoce alguno, cierre las demás sesiones.</p>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Últimos accesos</h3>
            <ul className="divide-y divide-line text-sm" aria-label="Historial de accesos">
              {data.history.length === 0 ? <li className="py-2 text-muted">Sin registros todavía.</li> : data.history.map((h, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-ink">{new Date(h.at).toLocaleString('es-MX')} · {h.device}{h.ip ? ` · ${h.ip}` : ''}</span>
                  <Badge variant={h.success ? 'success' : 'error'}>{h.success ? (h.method === 'google' ? 'Google' : 'Contraseña') : `Fallido: ${REASON[h.reason] ?? h.reason}`}</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {staff && data && (
        <Card>
          <div className="mb-2 flex items-center gap-2"><KeyRound className="h-4 w-4 text-purple" aria-hidden="true" /><h2 className="font-head text-base font-semibold text-ink">Segundo factor (app de autenticación)</h2></div>
          {err && <p className="mb-2 text-sm text-coral-600" role="alert">{err}</p>}
          {data.totp_enabled ? (
            <div className="space-y-3">
              <p className="text-sm text-muted"><Badge variant="success">Activo</Badge> Al entrar con contraseña se le pedirá un código de 6 dígitos.</p>
              <div className="flex flex-wrap items-end gap-2">
                <Input label="Código actual para desactivar" inputMode="numeric" value={disableCode} onChange={(e) => setDisableCode(e.target.value.replace(/[^0-9]/g, ''))} className="w-40" />
                <Button size="sm" variant="danger" onClick={() => disable.mutate()} loading={disable.isPending} disabled={disableCode.length < 6}><ShieldOff size={14} aria-hidden="true" /> Desactivar</Button>
              </div>
            </div>
          ) : setup ? (
            <div className="space-y-3">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                <li>Abra Google Authenticator, Microsoft Authenticator o 1Password.</li>
                <li>Agregue una cuenta con esta clave: <code className="select-all rounded bg-cream-2 px-1.5 py-0.5 text-ink">{setup.secret}</code> <a href={setup.otpauth_url} className="ml-1 font-semibold text-purple underline">o toque aquí desde el teléfono</a>.</li>
                <li>Escriba el código de 6 dígitos que muestra la app.</li>
              </ol>
              <div className="flex flex-wrap items-end gap-2">
                <Input label="Código" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))} className="w-40" />
                <Button size="sm" onClick={() => enable.mutate()} loading={enable.isPending} disabled={code.length < 6}>Activar</Button>
                <Button size="sm" variant="ghost" onClick={() => setSetup(null)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted">Recomendado para Dirección: un código de su teléfono además de la contraseña. El acceso con Google conserva la verificación de Google.</p>
              <Button size="sm" onClick={() => start.mutate()} loading={start.isPending}>Activar segundo factor</Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

export default SecurityPanel;
