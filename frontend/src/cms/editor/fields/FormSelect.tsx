/**
 * Form chooser (contract C5 «Form»): the site's own forms and the forms made
 * in Contenido, Formularios, by name. Stores the same slug as before.
 */
import { useQuery } from '@tanstack/react-query';
import { contentApi, type FormDefinitionAdmin } from '@/services/api';
import { describedBy, FieldLabel, FieldNotes, invalidClass, type FieldBaseProps } from './FieldShell';

/**
 * Forms built into the site (cms/blocks/generic.tsx BUILTIN_FORMS): the block shows a button to their page.
 * The ficha de inscripción is not one: it is private (the school sends each admitted family its link).
 */
export const SITE_FORMS: { value: string; label: string }[] = [
  { value: 'contacto', label: 'Contacto (botón a su página)' },
  { value: 'facturacion', label: 'Solicitud de factura (botón a su página)' },
  { value: 'agendar-visita', label: 'Agendar visita (botón a su página)' },
];

export interface FormSelectProps extends FieldBaseProps {
  value: string;
  onChange: (slug: string) => void;
}

export function FormSelect({ id, label, required, hint, error, warning, onBlur, value, onChange }: FormSelectProps) {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['admin-forms', 'picker'],
    queryFn: async () => {
      const d = (await contentApi.adminListForms()).data as FormDefinitionAdmin[] | { results?: FormDefinitionAdmin[] };
      return Array.isArray(d) ? d : d.results ?? [];
    },
    staleTime: 60_000,
    retry: false,
  });
  const forms = data ?? [];
  const known = !value || SITE_FORMS.some((f) => f.value === value) || forms.some((f) => f.slug === value);
  const chosen = forms.find((f) => f.slug === value);
  const warn = warning
    ?? (chosen && !chosen.is_published ? 'Este formulario no está publicado: en el sitio no se mostrará hasta publicarlo en Formularios.' : undefined)
    ?? (!known && !isLoading ? 'No encontramos este formulario. Elija otro de la lista.' : undefined);
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} required={required} />
      <select
        id={id}
        className={`input-field ${invalidClass(error)}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error, warning: warn })}
      >
        <option value="">Elija un formulario…</option>
        {!known && <option value={value}>{value} (no encontrado)</option>}
        <optgroup label="Formularios del sitio">
          {SITE_FORMS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </optgroup>
        {forms.length > 0 && (
          <optgroup label="Creados en Formularios">
            {forms.map((f) => <option key={f.slug} value={f.slug}>{f.title || f.slug}{f.is_published ? '' : ' (no publicado)'}</option>)}
          </optgroup>
        )}
      </select>
      {isError && <p className="mt-1.5 text-xs text-subtle">No se pudo cargar la lista de Formularios; se muestran solo los del sitio.</p>}
      <FieldNotes id={id} hint={hint} error={error} warning={warn} />
    </div>
  );
}
