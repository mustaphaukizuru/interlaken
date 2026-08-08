import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Save, Phone, Mail, MapPin, MessageCircle, Facebook, Instagram, Youtube,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { contentApi } from '@/services/api';
import { socialEntries } from '@/lib/siteContact';
import type { SiteSettings } from '@/types/content';

type SettingsForm = Omit<SiteSettings, 'updated_at'>;

const EMPTY: SettingsForm = {
  phone_display: '', phone_e164: '', whatsapp_number: '', contact_email: '',
  address: '', maps_url: '', office_hours: '',
  facebook_url: '', instagram_url: '', youtube_url: '',
};

const SOCIAL_ICONS = {
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
} as const;

const FIELD = 'min-h-[44px] text-base';

/** Live mock of public chrome driven by the form values (no invented fields). */
function SiteChromePreview({ form }: { form: SettingsForm }) {
  const socials = socialEntries(form);
  const hasPreheader =
    socials.length > 0 || Boolean(form.phone_display) || Boolean(form.contact_email);

  return (
    <Card
      title="Vista previa del sitio"
      subtitle="Así verán las familias el contacto y las redes en el sitio público."
    >
      <div className="overflow-hidden rounded-xl border border-line bg-cream">
        {/* Preheader + accent (escritorio) */}
        <p className="px-3 pt-3 text-[11px] font-semibold uppercase tracking-wide text-subtle">
          Barra superior
        </p>
        {hasPreheader ? (
          <div className="mx-3 mt-1.5 rounded-lg bg-brand-800 px-3 py-2 text-[11px] text-white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {socials.length > 0 ? socials.map(({ key, label }) => {
                  const Icon = SOCIAL_ICONS[key];
                  return (
                    <span
                      key={key}
                      title={label}
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/85"
                    >
                      <Icon className="h-3 w-3" aria-hidden="true" />
                    </span>
                  );
                }) : (
                  <span className="text-white/50">Sin redes configuradas</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-white/90">
                {form.phone_display && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3 w-3" aria-hidden="true" />
                    {form.phone_display}
                  </span>
                )}
                {form.contact_email && (
                  <span className="inline-flex max-w-[180px] items-center gap-1 truncate">
                    <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {form.contact_email}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="mx-3 mt-1.5 text-xs text-muted">
            Configure teléfono, correo o redes para mostrar la barra superior.
          </p>
        )}
        <div className="accent-bar mx-3 mt-2 rounded-full" aria-hidden="true" />

        {/* Contact strip / footer bits */}
        <p className="px-3 pt-4 text-[11px] font-semibold uppercase tracking-wide text-subtle">
          Pie de contacto
        </p>
        <div className="mx-3 mt-1.5 mb-3 rounded-lg bg-dark px-3 py-3 text-xs text-white/70">
          <ul className="space-y-2">
            {form.phone_display ? (
              <li className="flex items-start gap-2">
                <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{form.phone_display}</span>
              </li>
            ) : null}
            {form.contact_email ? (
              <li className="flex items-start gap-2">
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="break-all">{form.contact_email}</span>
              </li>
            ) : null}
            {form.address ? (
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{form.address}</span>
              </li>
            ) : null}
            {form.office_hours ? (
              <li className="text-white/50">{form.office_hours}</li>
            ) : null}
            {!form.phone_display && !form.contact_email && !form.address && (
              <li className="text-white/45">Sin datos de contacto aún.</li>
            )}
          </ul>
          {socials.length > 0 && (
            <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
              {socials.map(({ key, label }) => {
                const Icon = SOCIAL_ICONS[key];
                return (
                  <span
                    key={key}
                    title={label}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/70"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* WhatsApp float mock */}
        <div className="relative mx-3 mb-3 h-20 overflow-hidden rounded-lg border border-dashed border-line bg-white">
          <p className="absolute left-3 top-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">
            Botón de WhatsApp
          </p>
          {form.whatsapp_number ? (
            <div
              className="absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-600 text-white shadow-green"
              title={`wa.me/${form.whatsapp_number.replace(/\D/g, '')}`}
              aria-label="Vista previa del botón de WhatsApp"
            >
              <MessageCircle className="h-6 w-6" aria-hidden="true" />
            </div>
          ) : (
            <p className="absolute inset-x-3 bottom-3 text-xs text-muted">
              Sin número de WhatsApp: el botón flotante no se muestra.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function AdminSettings() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-site-settings'],
    queryFn: async () => (await contentApi.adminGetSettings()).data as SettingsForm,
  });
  const [form, setForm] = useState<SettingsForm>(EMPTY);
  useEffect(() => { if (data) setForm({ ...EMPTY, ...data }); }, [data]);
  const set = (k: keyof SettingsForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

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
        actions={
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            className="min-h-[44px] w-full sm:w-auto"
          >
            <Save className="h-4 w-4" /> Guardar
          </Button>
        }
      />

      {isError ? (
        <Card><ErrorState onRetry={() => refetch()} /></Card>
      ) : isLoading ? (
        <div className="skeleton h-64 rounded-xl2" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
          <div className="space-y-6">
            <Card title="Contacto">
              <div className="grid gap-5 sm:grid-cols-2">
                <Input
                  label="Teléfono (visible)"
                  className={FIELD}
                  value={form.phone_display}
                  onChange={(e) => set('phone_display', e.target.value)}
                  placeholder="Ej. (55) 5379-1188"
                />
                <Input
                  label="Teléfono (E.164)"
                  className={FIELD}
                  value={form.phone_e164}
                  onChange={(e) => set('phone_e164', e.target.value)}
                  placeholder="+5255…"
                  inputMode="tel"
                />
                <Input
                  label="WhatsApp"
                  className={FIELD}
                  value={form.whatsapp_number}
                  onChange={(e) => set('whatsapp_number', e.target.value)}
                  placeholder="52155…"
                  inputMode="tel"
                  hint="Solo dígitos; aparece como botón flotante en el sitio."
                />
                <Input
                  label="Correo de contacto"
                  type="email"
                  className={FIELD}
                  value={form.contact_email}
                  onChange={(e) => set('contact_email', e.target.value)}
                />
                <div className="sm:col-span-2">
                  <Input
                    label="Dirección"
                    className={FIELD}
                    value={form.address}
                    onChange={(e) => set('address', e.target.value)}
                  />
                </div>
                <Input
                  label="URL de Google Maps"
                  className={FIELD}
                  value={form.maps_url}
                  onChange={(e) => set('maps_url', e.target.value)}
                  placeholder="https://maps.app.goo.gl/…"
                />
                <Input
                  label="Horario de oficina"
                  className={FIELD}
                  value={form.office_hours}
                  onChange={(e) => set('office_hours', e.target.value)}
                  placeholder="Lunes–Viernes 8:00–16:00 hrs"
                />
              </div>
            </Card>

            <Card title="Redes sociales">
              <p className="mb-4 text-sm text-subtle">
                Deje un campo vacío para ocultar ese ícono en el sitio.
              </p>
              <div className="grid gap-5 sm:grid-cols-2">
                <Input
                  label="Facebook"
                  className={FIELD}
                  value={form.facebook_url}
                  onChange={(e) => set('facebook_url', e.target.value)}
                  placeholder="https://facebook.com/…"
                />
                <Input
                  label="Instagram"
                  className={FIELD}
                  value={form.instagram_url}
                  onChange={(e) => set('instagram_url', e.target.value)}
                  placeholder="https://instagram.com/…"
                />
                <Input
                  label="YouTube"
                  className={FIELD}
                  value={form.youtube_url}
                  onChange={(e) => set('youtube_url', e.target.value)}
                  placeholder="https://youtube.com/…"
                />
              </div>
            </Card>
          </div>

          <div className="lg:sticky lg:top-4">
            <SiteChromePreview form={form} />
          </div>
        </div>
      )}
    </>
  );
}
