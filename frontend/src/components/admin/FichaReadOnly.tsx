/**
 * The ficha de inscripción in «Revisar inscripción», read-only and grouped
 * like the school's Excel: Alumno, Domicilio, Datos adicionales, Padre,
 * Madre, Emergencia, Firma (plus who filled it in). Labels and options come
 * from the ficha schema; the health fields arrive masked from the server for
 * anyone who may not read them, and say so instead of showing blanks.
 */
import { Lock } from 'lucide-react';
import { displayValue, isHidden } from '@/components/admissions/ficha/choices';
import type { FichaPayload, FichaSchema, FichaStep } from '@/components/admissions/ficha/types';

/** Excel order; the contact (step 0) closes the list. */
const ORDER = ['alumno', 'domicilio', 'salud', 'padre', 'madre', 'emergencia'] as const;
const YES_NO = { yes: 'Sí', no: 'No' };

const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

function Rows({ rows }: { rows: [string, string | null][] }) {
  return (
    <dl className="divide-y divide-line-2">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-1 gap-0.5 py-1.5 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3">
          <dt className="text-subtle">{label}</dt>
          <dd className={value === null ? 'italic text-subtle' : 'break-words text-ink'}>{value ?? 'Sin dato'}</dd>
        </div>
      ))}
    </dl>
  );
}

function Group({ title, missing, children }: { title: string; missing?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line px-3 py-2.5">
      <h3 className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-subtle">
        {title}
        {missing ? <span className="rounded-full bg-amber-bright/20 px-2 py-0.5 text-[11px] normal-case tracking-normal text-amber">Faltan datos</span> : null}
      </h3>
      {children}
    </section>
  );
}

export function FichaReadOnly({ schema, ficha }: { schema: FichaSchema; ficha: FichaPayload }) {
  const step = (key: string) => schema.steps.find((s) => s.key === key);
  const missing = (key: string) => ficha.completeness?.sections?.[key]?.complete === false;
  const rowsOf = (st: FichaStep) => {
    const values = ficha.sections[st.key] ?? {};
    return st.fields
      .filter((f) => f.name !== 'not_applicable' && !isHidden(f, values))
      .map((f): [string, string | null] => [f.label, displayValue(schema, f, values[f.name], YES_NO)]);
  };
  const contact = step('contacto');
  return (
    <div className="space-y-3" aria-label="Ficha de inscripción">
      {ORDER.map((key) => {
        const st = step(key);
        if (!st) return null;
        const values = ficha.sections[key] ?? {};
        if (st.skip_if && values[st.skip_if.field] === st.skip_if.equals) {
          return <Group key={key} title={st.title}><p className="py-1 text-sm text-muted">No aplica</p></Group>;
        }
        if (key === 'salud' && ficha.medical_masked) {
          return (
            <Group key={key} title={st.title}>
              <p className="flex items-start gap-2 py-1 text-sm text-muted">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Datos de salud protegidos: los ve la dirección cuando la familia lo autorizó.
              </p>
            </Group>
          );
        }
        return <Group key={key} title={st.title} missing={missing(key)}><Rows rows={rowsOf(st)} /></Group>;
      })}
      {/* The acceptances themselves are in «Consentimientos», right below. */}
      <Group title="Firma">
        <Rows rows={[
          ['Firmó', ficha.firma.signed_name || null],
          ['Fecha de la firma', fmtDateTime(ficha.firma.signed_at) || null],
          ['IP de la firma', ficha.firma.signed_ip || null],
        ]} />
      </Group>
      {contact ? <Group title={contact.title} missing={missing('contacto')}><Rows rows={rowsOf(contact)} /></Group> : null}
    </div>
  );
}
