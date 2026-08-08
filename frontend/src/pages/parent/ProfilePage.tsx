import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Save, Bell, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuthStore, type User } from '@/store/authStore';
import { authApi } from '@/services/api';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador', staff: 'Personal', student: 'Alumno', parent: 'Padre/Tutor',
};

/** "Mi información" — name, WhatsApp, password, notification prefs. */
export default function ProfilePage() {
  const { user, setUser } = useAuthStore();
  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [whatsapp, setWhatsapp] = useState(user?.whatsapp ?? '');
  const [emailOn, setEmailOn] = useState(user?.notif_prefs?.email_enabled ?? true);
  const [inAppOn, setInAppOn] = useState(user?.notif_prefs?.in_app_enabled ?? true);
  const [pushOn, setPushOn] = useState(user?.notif_prefs?.push_enabled ?? true);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => authApi.updateMe({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      whatsapp: whatsapp.trim(),
    }),
    onSuccess: ({ data }) => {
      setUser(data as User);
      toast.success('Información actualizada correctamente.');
    },
    onError: () => toast.error('No se pudo guardar. Intenta de nuevo.'),
  });

  const prefsMutation = useMutation({
    mutationFn: async () => {
      const { data } = await authApi.updateNotifPrefs({
        email_enabled: emailOn,
        in_app_enabled: inAppOn,
        push_enabled: pushOn,
      });
      // Best-effort device subscribe/unsubscribe when the push preference flips.
      const { isPushSupported, enablePush, disablePush } = await import('@/services/push');
      if (isPushSupported()) {
        if (pushOn) await enablePush().catch(() => false);
        else await disablePush().catch(() => false);
      }
      return data;
    },
    onSuccess: async () => {
      const { data } = await authApi.me();
      setUser(data as User);
      toast.success('Preferencias de aviso guardadas.');
    },
    onError: () => toast.error('No se pudieron guardar las preferencias.'),
  });

  const passwordMutation = useMutation({
    mutationFn: () => authApi.setPassword(newPassword),
    onSuccess: async () => {
      setNewPassword('');
      setConfirmPassword('');
      const { data } = await authApi.me();
      setUser(data as User);
      toast.success('Contraseña guardada.');
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: { password?: string[]; detail?: string } } })?.response?.data;
      toast.error(data?.password?.[0] || data?.detail || 'No se pudo guardar la contraseña.');
    },
  });

  const dirty =
    firstName !== (user?.first_name ?? '') ||
    lastName !== (user?.last_name ?? '') ||
    whatsapp !== (user?.whatsapp ?? '');

  const prefsDirty =
    emailOn !== (user?.notif_prefs?.email_enabled ?? true) ||
    inAppOn !== (user?.notif_prefs?.in_app_enabled ?? true) ||
    pushOn !== (user?.notif_prefs?.push_enabled ?? true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (firstName.trim() && lastName.trim()) mutation.mutate();
  };

  const savePassword = (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('Mínimo 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Las contraseñas no coinciden.');
      return;
    }
    passwordMutation.mutate();
  };

  return (
    <>
      <PageHeader title="Mi información" subtitle="Actualiza tus datos de contacto y avisos" />
      <div className="mx-auto max-w-xl space-y-4">
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="pf-email">Correo</label>
                <input id="pf-email" className="input-field min-h-[44px] bg-cream text-base" value={user?.email ?? ''} disabled />
              </div>
              <div>
                <label className="label" htmlFor="pf-role">Rol</label>
                <input id="pf-role" className="input-field min-h-[44px] bg-cream text-base" value={ROLE_LABEL[user?.role ?? ''] ?? user?.role ?? ''} disabled />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="pf-first">Nombre</label>
                <input id="pf-first" className="input-field min-h-[44px] text-base" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div>
                <label className="label" htmlFor="pf-last">Apellidos</label>
                <input id="pf-last" className="input-field min-h-[44px] text-base" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="pf-wa">WhatsApp</label>
              <input id="pf-wa" type="tel" inputMode="tel" className="input-field min-h-[44px] text-base" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="Ej. 5512345678" />
              <p className="mt-1 text-xs text-subtle">Se usa para avisos y recordatorios del colegio.</p>
            </div>
            <div className="flex justify-end pt-1">
              <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!dirty || !firstName.trim() || !lastName.trim()} className="min-h-[44px]">
                <Save className="h-4 w-4" /> Guardar cambios
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <form onSubmit={savePassword} className="space-y-4">
            <h2 className="font-head text-base font-semibold text-ink">
              {user?.has_usable_password ? 'Cambiar contraseña' : 'Establecer contraseña'}
            </h2>
            {!user?.has_usable_password && (
              <p className="text-sm text-muted">
                Su cuenta aún no tiene contraseña local (acceso solo con Google o pendiente de activación).
              </p>
            )}
            <div>
              <label className="label" htmlFor="pf-pass">Nueva contraseña</label>
              <input id="pf-pass" type="password" autoComplete="new-password" className="input-field min-h-[44px] text-base" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="pf-pass2">Confirmar</label>
              <input id="pf-pass2" type="password" autoComplete="new-password" className="input-field min-h-[44px] text-base" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="secondary" loading={passwordMutation.isPending} disabled={!newPassword} className="min-h-[44px]">
                Guardar contraseña
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Bell className="h-4 w-4 text-purple" />
            <h2 className="font-head text-base font-semibold text-ink">Avisos</h2>
          </div>
          <p className="mb-4 text-sm text-muted">Elija cómo recibir compras de cafetería, saldos bajos y comunicados.</p>
          <div className="space-y-3">
            <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink">
              <span>Correo electrónico</span>
              <input type="checkbox" className="h-5 w-5" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
            </label>
            <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink">
              <span>En la aplicación</span>
              <input type="checkbox" className="h-5 w-5" checked={inAppOn} onChange={(e) => setInAppOn(e.target.checked)} />
            </label>
            <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink">
              <span>Notificaciones push (si estánó)</span>
              <input type="checkbox" className="h-5 w-5" checked={pushOn} onChange={(e) => setPushOn(e.target.checked)} />
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="primary" loading={prefsMutation.isPending} disabled={!prefsDirty} onClick={() => prefsMutation.mutate()} className="min-h-[44px]">
              Guardar avisos
            </Button>
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-purple" />
            <h2 className="font-head text-base font-semibold text-ink">Privacidad y derechos ARCO</h2>
          </div>
          <p className="mb-4 text-sm text-muted">
            Consulte y actualice consentimientos LFPDPPP, descargue sus datos o presente una
            solicitud de Acceso, Rectificación, Cancelación u Oposición.
          </p>
          <Link
            to="/portal/privacidad"
            className="inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-700 hover:underline"
          >
            Ir a Privacidad y ARCO
          </Link>
        </Card>
      </div>
    </>
  );
}
