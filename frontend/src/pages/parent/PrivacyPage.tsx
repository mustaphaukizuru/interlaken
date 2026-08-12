import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Scale, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { legalApi } from '@/services/api';

const PURPOSE_LABELS: Record<string, string> = {
  academic_processing: 'Tratamiento académico',
  cafeteria: 'Cafetería',
  photos_media: 'Fotografías y medios',
  communications_marketing: 'Comunicaciones y marketing',
  medical_data: 'Datos de salud',
};

const ARCO_TYPE_LABELS: Record<string, string> = {
  access: 'Acceso',
  rectification: 'Rectificación',
  cancellation: 'Cancelación',
  opposition: 'Oposición',
};

const ARCO_STATUS_VARIANT: Record<string, 'warning' | 'info' | 'success' | 'error' | 'neutral'> = {
  received: 'warning',
  in_review: 'info',
  resolved: 'success',
  rejected: 'error',
};

const ARCO_STATUS_LABELS: Record<string, string> = {
  received: 'Recibida',
  in_review: 'En revisión',
  resolved: 'Resuelta',
  rejected: 'Rechazada',
};

type ConsentState = Record<string, boolean>;

export default function PrivacyPage() {
  const qc = useQueryClient();
  const [arcoType, setArcoType] = useState('access');
  const [arcoDetails, setArcoDetails] = useState('');
  const [draft, setDraft] = useState<ConsentState | null>(null);

  const consentQ = useQuery({
    queryKey: ['legal-consent'],
    queryFn: async () => (await legalApi.getConsent()).data as {
      state: ConsentState;
      needs_acceptance: boolean;
      notice_version: string;
    },
  });

  const arcoQ = useQuery({
    queryKey: ['legal-arco'],
    queryFn: async () => {
      const { data } = await legalApi.listArco();
      const rows = data.results ?? data;
      return Array.isArray(rows) ? rows : [];
    },
  });

  const state = draft ?? consentQ.data?.state ?? null;
  const purposeKeys = useMemo(
    () => Object.keys(PURPOSE_LABELS),
    [],
  );

  const saveConsent = useMutation({
    mutationFn: () => {
      if (!state) throw new Error('no state');
      return legalApi.recordConsent(state);
    },
    onSuccess: () => {
      toast.success('Consentimientos actualizados.');
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['legal-consent'] });
    },
    onError: () => toast.error('No se pudieron guardar los consentimientos.'),
  });

  const createArco = useMutation({
    mutationFn: () => legalApi.createArco(arcoType, arcoDetails.trim()),
    onSuccess: () => {
      toast.success('Solicitud ARCO enviada.');
      setArcoDetails('');
      qc.invalidateQueries({ queryKey: ['legal-arco'] });
    },
    onError: () => toast.error('No se pudo enviar la solicitud ARCO.'),
  });

  const exportData = useMutation({
    mutationFn: async () => (await legalApi.exportMyData()).data,
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mis-datos-interlaken-${format(new Date(), 'yyyyMMdd')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Descarga de sus datos lista.');
    },
    onError: () => toast.error('No se pudo exportar sus datos.'),
  });

  const toggle = (key: string, value: boolean) => {
    const base = state ?? {};
    setDraft({ ...base, [key]: value });
  };

  const consentDirty = !!draft && JSON.stringify(draft) !== JSON.stringify(consentQ.data?.state);

  return (
    <>
      <PageHeader
        title="Privacidad y ARCO"
        subtitle="Gestione consentimientos LFPDPPP y ejerza sus derechos de Acceso, Rectificación, Cancelación u Oposición."
      />

      <div className="mx-auto max-w-2xl space-y-4">
        {consentQ.isError ? (
          <Card><ErrorState onRetry={() => consentQ.refetch()} /></Card>
        ) : consentQ.isLoading || !state ? (
          <Card><ListSkeleton rows={4} /></Card>
        ) : (
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-purple" />
              <h2 className="font-head text-base font-semibold text-ink">Consentimientos</h2>
            </div>
            {consentQ.data?.needs_acceptance && (
              <p className="mb-3 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-sm text-muted">
                Debe aceptar el tratamiento académico del aviso vigente
                {consentQ.data.notice_version ? ` (v${consentQ.data.notice_version})` : ''}.
              </p>
            )}
            <div className="space-y-3">
              {purposeKeys.map((key) => (
                <label
                  key={key}
                  className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink"
                >
                  <span>{PURPOSE_LABELS[key]}</span>
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    aria-label={PURPOSE_LABELS[key]}
                    checked={!!state[key]}
                    onChange={(e) => toggle(key, e.target.checked)}
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <Link to="/aviso-de-privacidad" className="text-sm font-medium text-brand-700 hover:underline">
                Ver Aviso de Privacidad
              </Link>
              <Button
                type="button"
                variant="primary"
                loading={saveConsent.isPending}
                disabled={!consentDirty}
                onClick={() => saveConsent.mutate()}
                className="min-h-[44px]"
              >
                Guardar consentimientos
              </Button>
            </div>
          </Card>
        )}

        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Download className="h-4 w-4 text-purple" />
            <h2 className="font-head text-base font-semibold text-ink">Acceso a mis datos</h2>
          </div>
          <p className="mb-4 text-sm text-muted">
            Descargue un archivo JSON con la información de su cuenta, hijos, pagos y consentimientos
            (sin secretos de pasarela).
          </p>
          <Button
            type="button"
            variant="secondary"
            loading={exportData.isPending}
            onClick={() => exportData.mutate()}
            className="min-h-[44px]"
          >
            <Download className="h-4 w-4" /> Descargar mis datos
          </Button>
        </Card>

        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Scale className="h-4 w-4 text-purple" />
            <h2 className="font-head text-base font-semibold text-ink">Solicitud ARCO</h2>
          </div>
          <p className="mb-4 text-sm text-muted">
            El colegio responde dentro del plazo legal (20 días hábiles).
          </p>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="arco-type">Tipo de solicitud</label>
              <select
                id="arco-type"
                className="input-field min-h-[44px] text-base"
                value={arcoType}
                onChange={(e) => setArcoType(e.target.value)}
              >
                {Object.entries(ARCO_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="arco-details">Detalle</label>
              <textarea
                id="arco-details"
                className="input-field min-h-[96px] resize-none text-base"
                value={arcoDetails}
                onChange={(e) => setArcoDetails(e.target.value)}
                placeholder="Describa su solicitud…"
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="primary"
                loading={createArco.isPending}
                disabled={arcoDetails.trim().length < 5}
                onClick={() => createArco.mutate()}
                className="min-h-[44px]"
              >
                Enviar solicitud
              </Button>
            </div>
          </div>

          <div className="mt-6 border-t border-line pt-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">Mis solicitudes</h3>
            {arcoQ.isError ? (
              <ErrorState onRetry={() => arcoQ.refetch()} />
            ) : arcoQ.isLoading ? (
              <ListSkeleton rows={2} />
            ) : !arcoQ.data?.length ? (
              <EmptyState
                icon={Scale}
                title="Sin solicitudes"
                description="Cuando envíe una solicitud ARCO aparecerá aquí."
              />
            ) : (
              <ul className="space-y-2">
                {arcoQ.data.map((row: {
                  id: number;
                  request_type: string;
                  status: string;
                  details: string;
                  statutory_deadline: string | null;
                  created_at: string;
                }) => (
                  <li key={row.id} className="rounded-xl border border-line px-3 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-ink">
                        {ARCO_TYPE_LABELS[row.request_type] ?? row.request_type}
                      </span>
                      <Badge variant={ARCO_STATUS_VARIANT[row.status] ?? 'neutral'}>
                        {ARCO_STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-muted line-clamp-2">{row.details}</p>
                    <p className="mt-1 text-xs text-subtle">
                      Enviada {format(new Date(row.created_at), 'd MMM yyyy', { locale: es })}
                      {row.statutory_deadline
                        ? ` · Plazo ${format(new Date(row.statutory_deadline), 'd MMM yyyy', { locale: es })}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
