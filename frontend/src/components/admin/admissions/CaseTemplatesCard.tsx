import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { apiFieldErrors, apiErrorMessage, type FieldErrorMap } from '@/lib/apiErrors';
import { casesApi, caseKeys, useCaseTemplates, type CaseTemplates } from '@/hooks/queries/cases';

/** Display order: the process order of the messages. */
const ORDER = ['costs', 'visit_link', 'exam_date', 'exam_result_accepted', 'exam_result_not_accepted', 'ficha_link'];

/**
 * Ajustes → «Mensajes del expediente»: the texts the Expediente sends
 * (cuotas, liga de visita, fecha y resultado del examen, liga de la ficha).
 * Each one lists the data it may use as chips (a tap inserts it where the
 * cursor is) and, when the server gives one, a hint (the «Aceptado» result
 * carries the private ficha link); an empty or restored text goes back to
 * the built-in wording.
 */
export function CaseTemplatesCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useCaseTemplates();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [saved, setSaved] = useState('');
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const save = useMutation({
    mutationFn: async (body: Record<string, string>) => (await casesApi.saveTemplates(body)).data,
    onSuccess: (res) => {
      qc.setQueryData<CaseTemplates>(caseKeys.templates, res);
      setDrafts({});
      setErrors({});
      setSaved('Mensajes guardados.');
      toast.success('Mensajes del expediente guardados.');
    },
    onError: (e) => {
      const f = apiFieldErrors(e);
      setErrors(Object.keys(f).length ? f : { detail: apiErrorMessage(e, 'No se pudieron guardar los mensajes.') });
    },
  });

  if (isError && !data) {
    return <Card title="Mensajes del expediente"><ErrorState title="No se pudieron cargar los mensajes" onRetry={() => refetch()} /></Card>;
  }
  if (isLoading || !data) {
    return <Card title="Mensajes del expediente"><div className="skeleton h-48 rounded-xl" role="status" aria-label="Cargando mensajes" /></Card>;
  }

  const keys = [...ORDER.filter((k) => k in data.templates), ...Object.keys(data.templates).filter((k) => !ORDER.includes(k))];
  const value = (k: string) => drafts[k] ?? data.templates[k] ?? '';
  const changed = Object.entries(drafts).filter(([k, v]) => v !== data.templates[k]);

  const insert = (k: string, placeholder: string) => {
    const el = refs.current[k];
    const text = value(k);
    const at = el ? el.selectionStart ?? text.length : text.length;
    const end = el ? el.selectionEnd ?? at : at;
    const next = `${text.slice(0, at)}${placeholder}${text.slice(end)}`;
    setDrafts((d) => ({ ...d, [k]: next }));
    setSaved('');
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + placeholder.length, at + placeholder.length);
    });
  };

  const submit = () => {
    // The built-in text is stored as «no customization» ('').
    const body = Object.fromEntries(changed.map(([k, v]) => [k, v.trim() === (data.defaults[k] ?? '').trim() ? '' : v]));
    save.mutate(body);
  };

  return (
    <Card title="Mensajes del expediente" subtitle="Lo que reciben las familias por correo o WhatsApp desde el expediente de admisión.">
      <div className="space-y-6">
        {keys.map((k) => {
          const custom = data.customized.includes(k);
          const isDefault = value(k).trim() === (data.defaults[k] ?? '').trim();
          const errId = `tpl-${k}-error`;
          const hint = data.hints?.[k];
          const hintId = `tpl-${k}-hint`;
          return (
            <div key={k} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={`tpl-${k}`} className="font-semibold text-ink">{data.labels[k] ?? k}</label>
                <Badge variant={custom ? 'info' : 'neutral'}>{custom ? 'Personalizado' : 'Texto del sistema'}</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5" aria-label={`Datos disponibles para «${data.labels[k] ?? k}»`} role="group">
                {(data.placeholders[k] ?? []).map((p) => (
                  <button key={p} type="button" onClick={() => insert(k, p)} aria-label={`Insertar ${p}`}
                    className="inline-flex min-h-[36px] items-center rounded-full bg-cream px-2.5 font-mono text-xs text-ink ring-1 ring-inset ring-line hover:bg-purple/10 hover:text-purple focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
                    {p}
                  </button>
                ))}
              </div>
              {hint && <p id={hintId} className="text-xs text-muted">{hint}</p>}
              <textarea
                id={`tpl-${k}`}
                ref={(el) => { refs.current[k] = el; }}
                className="input-field min-h-[120px] text-sm"
                value={value(k)}
                maxLength={2000}
                aria-invalid={errors[k] ? true : undefined}
                aria-describedby={[errors[k] ? errId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined}
                onChange={(e) => { setDrafts((d) => ({ ...d, [k]: e.target.value })); setSaved(''); }}
              />
              {errors[k] && <p id={errId} className="text-xs text-coral-600">{errors[k]}</p>}
              {!isDefault && (
                <Button type="button" size="sm" variant="ghost" onClick={() => { setDrafts((d) => ({ ...d, [k]: data.defaults[k] ?? '' })); setSaved(''); }}>
                  <RotateCcw size={14} aria-hidden="true" /> Restaurar el texto del sistema
                </Button>
              )}
            </div>
          );
        })}
        {errors.detail && <p role="alert" className="text-sm text-coral-600">{errors.detail}</p>}
        {Object.keys(errors).some((k) => k !== 'detail') && (
          <p role="alert" className="text-sm text-coral-600">Revise los mensajes marcados: hay datos que no existen.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={submit} loading={save.isPending} disabled={changed.length === 0}>Guardar mensajes</Button>
          {changed.length > 0 && <Button type="button" variant="ghost" onClick={() => { setDrafts({}); setErrors({}); }}>Descartar cambios</Button>}
          <p className="text-xs text-green-700" role="status" aria-live="polite">{saved}</p>
        </div>
      </div>
    </Card>
  );
}

export default CaseTemplatesCard;
