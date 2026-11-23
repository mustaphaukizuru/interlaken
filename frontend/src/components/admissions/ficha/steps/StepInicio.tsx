/**
 * Paso 0 · Antes de empezar (public start only). Who fills the ficha, the
 * child's name, grade and cycle, and how they found the school: POST
 * register/ creates the draft and its lead and answers with a session, so the
 * family goes straight on to the next step (the email link is for later).
 */
import { useMemo, useRef, useState, type FormEvent, type Ref } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import { apiErrorCode, apiErrorMessage, apiFieldErrors } from '@/lib/apiErrors';
import { fichaApi } from '../api';
import { bodyFor, fieldId, initialValues, sectionMissing, stepField } from '../choices';
import { fillText, type FichaCopy } from '../copy';
import { Field } from '../fields';
import { FichaFormProvider } from '../context';
import { Block, ErrorSummary, Row, StepHeading, useFocusFirstInvalid, useUnsavedWarning } from '../parts';
import { ResumeForm } from '../ResumeForm';
import type { FichaSchema, FieldErrors, StartResponse, Values } from '../types';

export function StepInicio({ schema, copy, onStarted, onClosed, headingRef }: {
  schema: FichaSchema;
  copy: FichaCopy;
  onStarted: (res: StartResponse) => void;
  onClosed: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const step = useMemo(() => schema.steps.find((s) => s.key === 'inicio')!, [schema]);
  const [values, setValues] = useState<Values>(() => initialValues(schema, step, {}));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [detail, setDetail] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const checklist = copy.list('checklist');
  // Typed but not sent yet: leaving the page asks first (nothing is saved on its own).
  const [pristine] = useState(() => JSON.stringify(bodyFor(step, initialValues(schema, step, {}))));
  useUnsavedWarning(JSON.stringify(bodyFor(step, values)) !== pristine);

  const set = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };
  const setMany = (patch: Values) => Object.entries(patch).forEach(([k, v]) => set(k, v));
  // The first field with a problem takes the focus; else the error line.
  const requestFocus = useFocusFirstInvalid();
  const showProblems = (names: string[]) => requestFocus(names.map((n) => fieldId(step.key, n)), summaryRef);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = sectionMissing(step, values, copy.t('errRequired'));
    if (Object.keys(missing).length) {
      setErrors(missing);
      setDetail(undefined);
      showProblems(Object.keys(missing));
      return;
    }
    setBusy(true);
    try {
      const { data } = await fichaApi.start(bodyFor(step, values));
      onStarted(data);
    } catch (err) {
      if (apiErrorCode(err) === 'public_start_disabled') {
        onClosed();
        return;
      }
      const fields = apiFieldErrors(err);
      const known = Object.fromEntries(Object.entries(fields).filter(([k]) => stepField(step, k)));
      setErrors(known);
      setDetail(Object.keys(known).length ? undefined : apiErrorMessage(err, copy.t('startError')));
      showProblems(Object.keys(known));
    } finally {
      setBusy(false);
    }
  };

  const problems = Object.keys(errors).length;
  const line = problems ? fillText(copy.t('errorSummary'), { n: problems }) : detail;

  return (
    <div className="card p-4 sm:p-8">
      <StepHeading ref={headingRef} title={copy.t('startTitle')} intro={copy.t('startIntro')} />
      {checklist.length ? (
        <div className="mb-6 rounded-md bg-cream-2 p-4">
          <p className="text-sm font-bold text-ink">{copy.t('checklistTitle')}</p>
          <ul className="mt-2 space-y-1.5">
            {checklist.map((item) => (
              <li key={item} className="flex items-start gap-2 text-base text-muted">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-strong" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ErrorSummary ref={summaryRef} line={line} />
      <FichaFormProvider value={{ schema, step, values, errors, set, setMany, copy }}>
        <form noValidate onSubmit={submit} className="space-y-8">
          <Block title={copy.t('whoTitle')}>
            <Field name="contact_name" autoComplete="name" />
            <Row>
              <Field name="contact_email" autoComplete="email" />
              <Field name="contact_phone" autoComplete="tel-national" />
            </Row>
            <Field name="contact_relationship" />
          </Block>
          <Block title={copy.t('childTitle')}>
            <Field name="child_given_names" />
            <Row>
              <Field name="child_paternal_surname" />
              <Field name="child_maternal_surname" />
            </Row>
            <Field name="grade_applying" className="sm:max-w-[50%] sm:pr-2.5" />
            <Field name="cycle" />
          </Block>
          <Block title={copy.t('moreTitle')}>
            <Field name="referral_source" />
            <Field name="wants_visit" />
            <Field name="message" />
          </Block>
          <PrivacyNote />
          <Button type="submit" variant="cta" size="lg" loading={busy} className="w-full sm:w-auto">
            {copy.t('startSubmit')} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </form>
      </FichaFormProvider>
      <div className="mt-10">
        <ResumeForm copy={copy} />
      </div>
    </div>
  );
}
