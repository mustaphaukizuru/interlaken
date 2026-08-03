import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/services/api';
import type { User } from '@/types';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador', staff: 'Personal', student: 'Alumno', parent: 'Padre/Tutor',
};

/** "Mi información" — families edit their own name + WhatsApp (used for avisos).
 * Email and role are read-only. The auth store is updated on save so the header
 * reflects the new name immediately. */
export default function ProfilePage() {
  const { user, setUser } = useAuthStore();
  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [whatsapp, setWhatsapp] = useState(user?.whatsapp ?? '');

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

  const dirty =
    firstName !== (user?.first_name ?? '') ||
    lastName !== (user?.last_name ?? '') ||
    whatsapp !== (user?.whatsapp ?? '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (firstName.trim() && lastName.trim()) mutation.mutate();
  };

  return (
    <>
      <PageHeader title="Mi información" subtitle="Actualiza tus datos de contacto" />
      <Card className="max-w-xl">
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
    </>
  );
}
