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
import { PasswordHelp } from '@/components/portal/PasswordHelp';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador', staff: 'Personal', student: 'Alumno', parent: 'Padre/Tutor',
};

/** "Mi información" — name, WhatsApp, notification prefs (password is admin-managed). */
export default function ProfilePage() {
  const { user, setUser } = useAuthStore();
  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [whatsapp, setWhatsapp] = useState(user?.whatsapp ?? '');
  const [emailOn, setEmailOn] = useState(user?.notif_prefs?.email_enabled ?? true);
  const [inAppOn, setInAppOn] = useState(user?.notif_prefs?.in_app_enabled ?? true);
  const [pushOn, setPushOn] = useState(user?.notif_prefs?.push_enabled ?? true);
  const [catCaf, setCatCaf] = useState(user?.notif_prefs?.cat_cafeteria ?? true);
  const [catPay, setCatPay] = useState(user?.notif_prefs?.cat_payment ?? true);
  const [catInfo, setCatInfo] = useState(user?.notif_prefs?.cat_info ?? true);

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
        cat_cafeteria: catCaf,
        cat_payment: catPay,
        cat_info: catInfo,
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

  const dirty =
    firstName !== (user?.first_name ?? '') ||
    lastName !== (user?.last_name ?? '') ||
    whatsapp !== (user?.whatsapp ?? '');

  const prefsDirty =
    emailOn !== (user?.notif_prefs?.email_enabled ?? true) ||
    inAppOn !== (user?.notif_prefs?.in_app_enabled ?? true) ||
    pushOn !== (user?.notif_prefs?.push_enabled ?? true) ||
    catCaf !== (user?.notif_prefs?.cat_cafeteria ?? true) ||
    catPay !== (user?.notif_prefs?.cat_payment ?? true) ||
    catInfo !== (user?.notif_prefs?.cat_info ?? true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (firstName.trim() && lastName.trim()) mutation.mutate();
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
          <PasswordHelp email={user?.email} />
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
              <span>Notificaciones push (si están activadas en este dispositivo)</span>
              <input type="checkbox" className="h-5 w-5" checked={pushOn} onChange={(e) => setPushOn(e.target.checked)} />
            </label>
          </div>
          <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-subtle">Qué avisos recibir</p>
          <div className="space-y-3">
            <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink">
              <span>Cafetería (compras, recargas, saldo)</span>
              <input type="checkbox" className="h-5 w-5" checked={catCaf} onChange={(e) => setCatCaf(e.target.checked)} />
            </label>
            <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink">
              <span>Pagos en línea</span>
              <input type="checkbox" className="h-5 w-5" checked={catPay} onChange={(e) => setCatPay(e.target.checked)} />
            </label>
            <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink">
              <span>Comunicados y avisos del colegio</span>
              <input type="checkbox" className="h-5 w-5" checked={catInfo} onChange={(e) => setCatInfo(e.target.checked)} />
            </label>
            <p className="text-xs text-subtle">Las alertas urgentes (emergencias, saldo muy bajo) siempre se envían.</p>
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
