import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { admissionsApi } from '@/services/api';
import { apiErrors } from '@/cms/editor/helpers';

/** Ajustes → plantillas de admisiones (BACKLOG P4-1). */
export function AdmissionTemplatesCard() {
  const { data } = useQuery({ queryKey: ['admissions-templates'], queryFn: async () => (await admissionsApi.getTemplates()).data });
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const value = draft ?? data?.missing_docs ?? '';
  const save = useMutation({
    mutationFn: (missing_docs: string) => admissionsApi.updateTemplates({ missing_docs }),
    onSuccess: () => { toast.success('Plantilla guardada.'); setDraft(null); setError(''); },
    onError: (e) => setError(apiErrors(e).missing_docs || 'No se pudo guardar.'),
  });
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
