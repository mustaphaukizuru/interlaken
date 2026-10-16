import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { admissionsApi } from '@/services/api';
import { apiFieldErrors } from '@/lib/apiErrors';

type Templates = { missing_docs: string; default_missing_docs: string; placeholders: string[] };

const TEMPLATES_KEY = ['admissions-templates'] as const;

/** Ajustes → plantillas de admisiones (BACKLOG P4-1). */
export function AdmissionTemplatesCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: async () => (await admissionsApi.getTemplates()).data as Templates,
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const value = draft ?? data?.missing_docs ?? '';
  const save = useMutation({
    mutationFn: (missing_docs: string) => admissionsApi.updateTemplates({ missing_docs }),
    onSuccess: (res, sent) => {
      // Write the saved text into the cache before dropping the draft, so the
      // textarea keeps showing what was just saved (not the old cached copy).
      const saved = res?.data?.missing_docs ?? sent;
      qc.setQueryData<Templates>(TEMPLATES_KEY, (prev) => (prev ? { ...prev, missing_docs: saved } : prev));
      setDraft(null);
      setError('');
      qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
      toast.success('Plantilla guardada.');
    },
    onError: (e) => setError(apiFieldErrors(e).missing_docs || 'No se pudo guardar.'),
  });

  if (isError && !data) {
    return (
      <Card title="Plantillas de admisiones">
        <ErrorState title="No se pudo cargar la plantilla" onRetry={() => refetch()} />
      </Card>
    );
  }
  if (isLoading) {
    return (
      <Card title="Plantillas de admisiones">
        <div className="skeleton h-48 rounded-xl" role="status" aria-label="Cargando plantilla" />
      </Card>
    );
  }

  return (
    <Card title="Plantillas de admisiones">
      <p className="mb-2 text-sm text-subtle">Correo que se envía desde el pipeline con «Pedir documentos». Puede usar: {(data?.placeholders ?? []).map((p) => <code key={p} className="mx-0.5 rounded bg-cream-2 px-1">{p}</code>)}</p>
      <label className="label" htmlFor="tpl-missing">Documentos faltantes</label>
      <textarea id="tpl-missing" className="input-field font-mono text-sm" rows={8} value={value} onChange={(e) => setDraft(e.target.value)} />
      {error && <p className="mt-1 text-sm text-coral-600" role="alert">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => save.mutate(value)} loading={save.isPending} disabled={draft === null}>Aplicar plantilla</Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft(data?.default_missing_docs ?? '')}>Restaurar la predeterminada</Button>
      </div>
    </Card>
  );
}

export default AdmissionTemplatesCard;
