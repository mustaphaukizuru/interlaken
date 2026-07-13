import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { contentApi } from '@/services/api';

interface Settings {
  phone_display: string; phone_e164: string; whatsapp_number: string; contact_email: string;
  address: string; maps_url: string; office_hours: string;
  facebook_url: string; instagram_url: string; youtube_url: string;
}
const EMPTY: Settings = {
  phone_display: '', phone_e164: '', whatsapp_number: '', contact_email: '',
  address: '', maps_url: '', office_hours: '',
  facebook_url: '', instagram_url: '', youtube_url: '',
};

export default function AdminSettings() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-site-settings'],
    queryFn: async () => (await contentApi.adminGetSettings()).data as Settings,
  });
  const [form, setForm] = useState<Settings>(EMPTY);
  useEffect(() => { if (data) setForm({ ...EMPTY, ...data }); }, [data]);
  const set = (k: keyof Settings, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => contentApi.adminUpdateSettings({ ...form }),
    onSuccess: () => toast.success('Ajustes guardados. El sitio público se actualizará.'),
    onError: () => toast.error('No se pudieron guardar los ajustes.'),
  });

  return (
    <>
      <PageHeader
        title="Ajustes del sitio"
        subtitle="Datos de contacto y redes que se muestran en el sitio público."
        actions={<Button onClick={() => save.mutate()} loading={save.isPending}><Save className="h-4 w-4" /> Guardar</Button>}
      />

      {isError ? (
        <Card><ErrorState onRetry={() => refetch()} /></Card>
      ) : isLoading ? (
        <div className="skeleton h-64 rounded-xl2" />
      ) : (
        <div className="space-y-6">
          <Card title="Contacto">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Teléfono (visible)" value={form.phone_display} onChange={(e) => set('phone_display', e.target.value)} />
              <Input label="Teléfono (E.164)" value={form.phone_e164} onChange={(e) => set('phone_e164', e.target.value)} placeholder="+52..." />
              <Input label="WhatsApp" value={form.whatsapp_number} onChange={(e) => set('whatsapp_number', e.target.value)} />
              <Input label="Correo de contacto" type="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} />
              <div className="sm:col-span-2">
                <Input label="Dirección" value={form.address} onChange={(e) => set('address', e.target.value)} />
              </div>
              <Input label="URL de Google Maps" value={form.maps_url} onChange={(e) => set('maps_url', e.target.value)} />
              <Input label="Horario de oficina" value={form.office_hours} onChange={(e) => set('office_hours', e.target.value)} />
            </div>
          </Card>

          <Card title="Redes sociales">
            <p className="mb-4 text-xs text-subtle">Deja un campo vacío para ocultar ese ícono en el sitio.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Facebook" value={form.facebook_url} onChange={(e) => set('facebook_url', e.target.value)} placeholder="https://facebook.com/…" />
              <Input label="Instagram" value={form.instagram_url} onChange={(e) => set('instagram_url', e.target.value)} placeholder="https://instagram.com/…" />
              <Input label="YouTube" value={form.youtube_url} onChange={(e) => set('youtube_url', e.target.value)} placeholder="https://youtube.com/…" />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
