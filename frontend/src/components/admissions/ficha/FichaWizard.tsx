/**
 * The «Ficha de inscripción» at /pre-registro (Fase 2). It replaced the short
 * pre-registro form and the old /inscripcion wizard.
 *
 * The ficha is private (2026-11-21): the school sends each family its link
 * once the child is admitted (exam «Aceptado»). Opened without a link or a
 * session, the page shows «La ficha de inscripción es personal»
 * (PrivateFicha); step 0 only exists when Ajustes allows a public start, or
 * for the school's staff (admin, or the «admisiones» area: ./staffView), who
 * see the whole ficha under a «Vista del personal» banner to fill it with a
 * family at the office. Until a remembered staff login is confirmed the
 * page shows its loading state, so a visitor never sees the form flash.
 *
 *   0 Antes de empezar (public start only, unnumbered) · 1 Información del
 *   alumno · 2 Domicilio · 3 Información de salud · 4 Información del padre ·
 *   5 Información de la madre · 6 Contacto de emergencia · 7 Revisión y firma
 *
 * Every numbered step reads «Paso n de 7: título» (its heading, the list
 * «Ver los pasos», the review, «Corregir»).
 *
 * Steps, fields, options and required rules come from GET ficha/schema/; the
 * words around them are the CMS props (`copy`). Each step is saved when the
 * family moves on (PATCH ficha/<section>/) and the server's completeness map
 * drives the step bar. A staff link (`?rid=&token=`, also the old
 * /inscripcion links) is exchanged once for a session, skips step 0 and
 * opens on the first step with something missing; the token then leaves the
 * address bar. «Guardar y continuar después» saves and emails a fresh link.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, Link2Off, MailCheck, Send } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { apiErrorCode, apiErrorMessage, apiErrorStatus, apiFieldErrors } from '@/lib/apiErrors';
import { FunnelEvent, trackEvent } from '@/services/analytics';
import { fichaApi } from './api';
import { bodyFor, fieldId, initialValues, isBlank, messagesFor, sectionMissing, splitFullName, stepField } from './choices';
import { fillText, numberedTitle, stepNumber, type FichaCopy, type TextKey } from './copy';
import { FichaDone } from './FichaDone';
import { Field } from './fields';
import { FichaFormProvider } from './context';
import { ErrorSummary, Panel, SaveStatus, StepHeading, type SaveState, type SummaryItem } from './parts';
import { PrivateFicha } from './PrivateFicha';
import { StaffBanner } from './StaffBanner';
import { useStaffView } from './staffView';
import { ResumeForm } from './ResumeForm';
import { clearSession, loadSession, saveSession, type FichaSession } from './session';
import { StepBar, type StepBarItem, type StepState } from './StepBar';
import { StepAlumno } from './steps/StepAlumno';
import { StepContacto } from './steps/StepContacto';
import { StepDomicilio } from './steps/StepDomicilio';
import { StepEmergencia } from './steps/StepEmergencia';
import { StepInicio } from './steps/StepInicio';
import { StepRevision } from './steps/StepRevision';
import { StepSalud } from './steps/StepSalud';
import { StepTutor } from './steps/StepTutor';
import type { Completeness, FichaPayload, FichaStep, FieldErrors, StartResponse, Values } from './types';

type Phase = 'booting' | 'start' | 'closed' | 'link-error' | 'expired' | 'wizard' | 'later' | 'done' | 'sent';

/** Whether the page's hero shows (only next to the public start). */
export type FichaView = 'start' | 'other';

const FIRMA = 'firma';
const CONTACTO = 'contacto';
const GUARDIANS: Record<string, string> = { padre: 'Padre', madre: 'Madre' };

/** Step key → its title in the copy (the step's heading, list, review and «Corregir»). */
const TITLE_KEY: Record<string, TextKey> = {
  alumno: 'alumnoTitle', domicilio: 'domicilioTitle', salud: 'saludTitle', padre: 'padreTitle', madre: 'madreTitle',
  emergencia: 'emergenciaTitle', contacto: 'contactoTitle', firma: 'reviewTitle',
};
const INTRO_KEY: Record<string, TextKey> = {
  alumno: 'alumnoIntro', domicilio: 'domicilioIntro', salud: 'saludIntro', padre: 'tutorIntro', madre: 'tutorIntro',
  emergencia: 'emergenciaIntro', contacto: 'contactoIntro', firma: 'reviewIntro',
};

const snapshot = (step: FichaStep, values: Values | undefined) => JSON.stringify(bodyFor(step, values ?? {}));

/** A guardian block nobody has written in yet. */
const blockIsEmpty = (v: Values | undefined) => !v || (v.not_applicable !== true
  && ['given_names', 'paternal_surname', 'maternal_surname', 'email', 'mobile'].every((k) => isBlank(v[k])));

export interface FichaWizardProps {
  copy: FichaCopy;
  /** Tells the page whether the hero belongs on screen (before paint). */
  onView?: (view: FichaView) => void;
  /** «Descargar mi ficha (PDF)» on the confirmation (FichaPdfSlot.tsx). */
  downloadSlot?: (ctx: { registrationId: number; sessionToken: string; childName: string }) => ReactNode;
}

export function FichaWizard({ copy, onView, downloadSlot }: FichaWizardProps) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  // Read once: the link leaves the address bar as soon as it is exchanged.
  const [link] = useState(() => {
    const rid = Number(params.get('rid')) || 0;
    const token = params.get('token') || '';
    return rid && token ? { rid, token } : null;
  });
  const [stored] = useState(() => (link ? null : loadSession()));

  const schemaQ = useQuery({
    queryKey: ['ficha-schema'],
    queryFn: async () => (await fichaApi.schema()).data,
    staleTime: 10 * 60_000,
  });
  const schema = schemaQ.data;

  const [phase, setPhase] = useState<Phase>(link || stored ? 'booting' : 'start');
  const [session, setSession] = useState<FichaSession | null>(null);
  const [ficha, setFicha] = useState<FichaPayload | null>(null);
  const [values, setValues] = useState<Record<string, Values>>({});
  const [completeness, setCompleteness] = useState<Completeness | null>(null);
  const [errors, setErrors] = useState<Record<string, FieldErrors>>({});
  const [detail, setDetail] = useState<string | undefined>();
  const [stepKey, setStepKey] = useState('alumno');
  const [reached, setReached] = useState(0);
  const [toReview, setToReview] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [busy, setBusy] = useState(false);
  const [prefilled, setPrefilled] = useState<Record<string, boolean>>({});
  const [invitedBanner, setInvitedBanner] = useState(false);
  const [submitProblems, setSubmitProblems] = useState<string[]>([]);
  const [later, setLater] = useState<{ email: string; state: 'sending' | 'sent' | 'error' } | null>(null);
  const baseline = useRef<Record<string, string>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  // The school's staff opening the page without a family's link: the whole ficha.
  const staffView = useStaffView();
  const staffMode = staffView === 'staff' && !link;
  const privateStart = phase === 'start' && schema?.public_start_enabled === false;
  const closed = privateStart && !staffMode;
  // A remembered staff login not confirmed yet: neither the form nor the panel.
  const deciding = privateStart && !link && staffView === 'unknown';
  const staffBanner = staffMode ? <StaffBanner /> : null;
  const view: FichaView = phase === 'start' || phase === 'closed' ? 'start' : 'other';
  useLayoutEffect(() => { onView?.(view); }, [view, onView]);

  /** The wizard's steps, in the schema's order: alumno … emergencia, then firma. */
  const order = useMemo(
    () => (schema?.steps ?? []).filter((s) => s.key !== 'inicio' && s.key !== CONTACTO).map((s) => s.key),
    [schema],
  );
  const stepOf = useCallback((key: string) => schema?.steps.find((s) => s.key === key), [schema]);

  // Focus the new heading (and bring the wizard into view) after every move.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    topRef.current?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    headingRef.current?.focus({ preventScroll: true });
  }, [stepKey, phase, reduced]);

  const move = useCallback((next: Phase | null, key?: string) => {
    moved.current = true;
    if (key) setStepKey(key);
    if (next) setPhase(next);
  }, []);
  const focusSummary = () => { setTimeout(() => summaryRef.current?.focus(), 0); };

  const expire = () => {
    clearSession();
    setSession(null);
    move('expired');
  };

  /** A ficha arrived (start, link, stored session): seed every step and open the first one missing data. */
  const open = useCallback((f: FichaPayload, s: FichaSession, opts: { invited: boolean }) => {
    if (!schema) return;
    setFicha(f);
    setSession(s);
    if (!f.editable || f.status !== 'draft') {
      clearSession();
      move('sent');
      return;
    }
    const vals: Record<string, Values> = {};
    for (const key of schema.patch_sections) {
      const st = schema.steps.find((x) => x.key === key);
      if (st) vals[key] = initialValues(schema, st, f.sections[key]);
    }
    const firmaStep = schema.steps.find((x) => x.key === FIRMA);
    if (firmaStep) {
      vals[FIRMA] = { ...initialValues(schema, firmaStep, {}), consent_photos_media: !!f.firma.consent_photos_media, signed_name: f.firma.signed_name || '' };
    }
    // The person filling the ficha is often the madre or the padre: offer their data in that block.
    const pre: Record<string, boolean> = {};
    const contact = vals[CONTACTO] ?? {};
    for (const [role, relationship] of Object.entries(GUARDIANS)) {
      if (contact.contact_relationship === relationship && blockIsEmpty(vals[role])) {
        const name = splitFullName(String(contact.contact_name ?? ''));
        vals[role] = {
          ...vals[role], given_names: name.given, paternal_surname: name.paternal, maternal_surname: name.maternal,
          mobile: contact.contact_phone ?? '', email: contact.contact_email ?? '',
        };
        pre[role] = true;
      }
    }
    for (const key of Object.keys(vals)) {
      const st = schema.steps.find((x) => x.key === key);
      if (st) baseline.current[key] = snapshot(st, vals[key]);
    }
    setValues(vals);
    setPrefilled(pre);
    setCompleteness(f.completeness);
    setErrors({});
    const keys = schema.steps.filter((x) => x.key !== 'inicio' && x.key !== CONTACTO).map((x) => x.key);
    const first = keys.find((k) => k !== FIRMA && f.completeness.sections[k] && !f.completeness.sections[k].complete) ?? FIRMA;
    setReached(keys.indexOf(first));
    setToReview(false);
    setInvitedBanner(opts.invited);
    move('wizard', first);
  }, [schema, move]);

  // Boot: a link in the URL, or a session this tab already holds.
  const booted = useRef(false);
  useEffect(() => {
    if (!schema || booted.current || !(link || stored)) return;
    booted.current = true;
    void (async () => {
      let s: FichaSession;
      try {
        if (link) {
          const { data } = await fichaApi.exchange(link.rid, link.token);
          s = { id: link.rid, token: data.session_token, expires: data.expires_at ?? null };
          saveSession(s);
          navigate({ search: '' }, { replace: true });
        } else {
          s = stored!;
        }
      } catch {
        move('link-error');
        return;
      }
      try {
        const { data } = await fichaApi.get(s.id, s.token);
        open(data, s, { invited: !!link });
      } catch {
        clearSession();
        move(link ? 'link-error' : 'start');
      }
    })();
  }, [schema, link, stored, navigate, open, move]);

  const onStarted = (res: StartResponse) => {
    const s = { id: res.id, token: res.session_token, expires: res.session_expires_at };
    saveSession(s);
    // A ficha the office starts for a family is not a website conversion.
    if (!staffMode) trackEvent(FunnelEvent.SubmitPreRegister, { grade: res.ficha.sections.alumno?.grade_applying ?? '' });
    open(res.ficha, s, { invited: false });
  };

  // ── editing ────────────────────────────────────────────────────────────
  const setField = (section: string) => (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [section]: { ...prev[section], [name]: value } }));
    setErrors((prev) => {
      if (!prev[section]?.[name]) return prev;
      const next = { ...prev[section] };
      delete next[name];
      return { ...prev, [section]: next };
    });
  };
  const setFields = (section: string) => (patch: Values) => {
    setValues((prev) => ({ ...prev, [section]: { ...prev[section], ...patch } }));
    setErrors((prev) => {
      const next = { ...(prev[section] ?? {}) };
      for (const k of Object.keys(patch)) delete next[k];
      return { ...prev, [section]: next };
    });
  };

  /** PATCH one section. Resolves with the stored values, or null when it did not save (errors shown). */
  const persist = async (key: string): Promise<{ values: Values; completeness: Completeness } | null> => {
    const step = stepOf(key);
    if (!schema || !step || !session) return null;
    if (!step.patchable) return { values: values[key] ?? {}, completeness: completeness! };
    setSaveState('saving');
    setDetail(undefined);
    try {
      const { data } = await fichaApi.save(session.id, key, bodyFor(step, values[key]), session.token);
      const merged = initialValues(schema, step, { ...values[key], ...data.data });
      setValues((prev) => ({ ...prev, [key]: merged }));
      baseline.current[key] = snapshot(step, merged);
      setCompleteness(data.completeness);
      setSaveState('saved');
      return { values: merged, completeness: data.completeness };
    } catch (err) {
      const status = apiErrorStatus(err);
      if (status === 401) { expire(); return null; }
      if (status === 409 && apiErrorCode(err) === 'not_draft') { clearSession(); move('sent'); return null; }
      if (status === 400) {
        const fields = apiFieldErrors(err);
        const own = Object.fromEntries(Object.entries(fields).filter(([k]) => stepField(step, k)));
        setErrors((prev) => ({ ...prev, [key]: own }));
        setSaveState('idle');
        if (!Object.keys(own).length) setDetail(apiErrorMessage(err, copy.t('saveError')));
      } else {
        setSaveState('error');
        setDetail(status === 403 ? apiErrorMessage(err, copy.t('saveError')) : copy.t('saveError'));
      }
      focusSummary();
      return null;
    }
  };

  const go = (key: string, opts: { review?: boolean } = {}) => {
    setToReview(!!opts.review);
    setDetail(undefined);
    setInvitedBanner(false);
    move(null, key);
  };

  /** «Guardar y continuar»: save, stop on what is missing, else the next step (or back to the review). */
  const next = async () => {
    if (!schema) return;
    const step = stepOf(stepKey);
    if (!step) return;
    setBusy(true);
    const saved = await persist(stepKey);
    setBusy(false);
    if (!saved) return;
    const all = { ...values, [stepKey]: saved.values };
    const names = saved.completeness.sections[stepKey]?.missing ?? [];
    const missing = names.length ? messagesFor(schema, step, names, all, copy.t('errRequired')) : {};
    setErrors((prev) => ({ ...prev, [stepKey]: missing }));
    if (Object.keys(missing).length) { focusSummary(); return; }
    if (stepKey === CONTACTO || toReview) { go(FIRMA); return; }
    const target = order[order.indexOf(stepKey) + 1] ?? FIRMA;
    setReached((r) => Math.max(r, order.indexOf(target)));
    go(target);
  };

  /** Back / a step of the bar: save first when something changed (format errors keep the family here). */
  const leaveTo = async (key: string) => {
    const step = stepOf(stepKey);
    if (step?.patchable && snapshot(step, values[stepKey]) !== baseline.current[stepKey]) {
      setBusy(true);
      const saved = await persist(stepKey);
      setBusy(false);
      if (!saved) return;
    }
    go(key);
  };

  const back = () => {
    const i = order.indexOf(stepKey);
    void leaveTo(stepKey === CONTACTO ? FIRMA : order[Math.max(0, i - 1)]);
  };

  /** «Guardar y continuar después»: save this step, then email a fresh link to the contact. */
  const saveForLater = async () => {
    const step = stepOf(stepKey);
    if (step?.patchable) {
      setBusy(true);
      const saved = await persist(stepKey);
      setBusy(false);
      if (!saved) return;
    }
    const email = String(values[CONTACTO]?.contact_email ?? '');
    setLater({ email, state: 'sending' });
    move('later');
    try {
      await fichaApi.resume(email);
      setLater({ email, state: 'sent' });
    } catch {
      setLater({ email, state: 'error' });
    }
  };

  /** Paso 7: the signature, then POST submit; an «incomplete» answer goes back to its steps and fields. */
  const submit = async () => {
    if (!schema || !session) return;
    const firmaStep = stepOf(FIRMA);
    if (!firmaStep) return;
    const fv = values[FIRMA] ?? {};
    const signed = String(fv.signed_name ?? '').trim().split(/\s+/).filter(Boolean);
    const missing = sectionMissing(firmaStep, fv, copy.t('errRequired'));
    if (signed.length < 2) missing.signed_name = stepField(firmaStep, 'signed_name')?.message || copy.t('errRequired');
    if (Object.keys(missing).length) {
      setErrors((prev) => ({ ...prev, [FIRMA]: missing }));
      setSubmitProblems([]);
      focusSummary();
      return;
    }
    setBusy(true);
    setDetail(undefined);
    try {
      await fichaApi.submit(session.id, { accept_privacy: true, signed_name: signed.join(' '), consent_photos_media: fv.consent_photos_media === true }, session.token);
      clearSession();
      if (!staffMode) trackEvent(FunnelEvent.SubmitFicha, { grade: values.alumno?.grade_applying ?? '' });
      move('done');
    } catch (err) {
      const status = apiErrorStatus(err);
      const body = (err as { response?: { data?: { sections?: Record<string, Record<string, string[]>> } } }).response?.data;
      if (status === 401) { expire(); return; }
      if (status === 400 && apiErrorCode(err) === 'incomplete' && body?.sections) {
        const mapped: Record<string, FieldErrors> = {};
        for (const [section, fields] of Object.entries(body.sections)) {
          mapped[section] = Object.fromEntries(Object.entries(fields).map(([f, msgs]) => [f, Array.isArray(msgs) ? String(msgs[0]) : String(msgs)]));
        }
        setErrors((prev) => ({ ...prev, ...mapped }));
        setSubmitProblems(Object.keys(mapped).filter((k) => k !== FIRMA));
        setCompleteness((prev) => prev && ({
          ...prev,
          complete: false,
          sections: Object.fromEntries(Object.entries(prev.sections).map(([k, v]) => [k, mapped[k] ? { complete: false, missing: Object.keys(mapped[k]) } : v])),
        }));
      } else {
        setSubmitProblems([]);
        setDetail(apiErrorMessage(err, copy.t('submitError')));
      }
      focusSummary();
    } finally {
      setBusy(false);
    }
  };

  // ── rendering ──────────────────────────────────────────────────────────
  if (schemaQ.isError) {
    return (
      <Shell topRef={topRef} banner={staffBanner}>
        <Panel icon={<AlertTriangle className="h-7 w-7" />} tone="warn" title={copy.t('loadError')}>
          <Button className="mt-4" variant="secondary" onClick={() => void schemaQ.refetch()}>{copy.t('retryLabel')}</Button>
        </Panel>
      </Shell>
    );
  }

  if (!schema || phase === 'booting' || deciding) {
    return (
      <Shell topRef={topRef} banner={staffBanner}>
        <div className="card flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-muted" role="status" aria-live="polite">
          <span className="h-9 w-9 rounded-full border-[3px] border-line border-t-purple motion-safe:animate-spin" aria-hidden="true" />
          {phase === 'booting' ? copy.t('booting') : <span className="sr-only">{copy.t('booting')}</span>}
        </div>
      </Shell>
    );
  }

  // The ficha is private: without a personal link (or a session) the page
  // explains how a family gets one (Ajustes may still allow a public start).
  if (phase === 'closed' || closed) {
    return (
      <Shell topRef={topRef} banner={staffBanner}>
        <PrivateFicha copy={copy} headingRef={headingRef} />
      </Shell>
    );
  }

  if (phase === 'start') {
    return (
      <Shell topRef={topRef} banner={staffBanner}>
        <StepInicio schema={schema} copy={copy} onStarted={onStarted} onClosed={() => move('closed')} headingRef={headingRef} />
      </Shell>
    );
  }

  if (phase === 'link-error' || phase === 'expired') {
    return (
      <Shell topRef={topRef} banner={staffBanner}>
        <Panel icon={<Link2Off className="h-7 w-7" />} tone="warn" headingRef={headingRef}
          title={phase === 'expired' ? copy.t('expiredTitle') : copy.t('inviteErrorTitle')}>
          <p>{phase === 'expired' ? copy.t('sessionExpired') : copy.t('inviteErrorText')}</p>
        </Panel>
        <div className="card mt-4 p-4 sm:p-6"><ResumeForm copy={copy} startOpen /></div>
      </Shell>
    );
  }

  if (phase === 'sent') {
    return (
      <Shell topRef={topRef} banner={staffBanner}>
        <Panel icon={<MailCheck className="h-7 w-7" />} tone="success" title={copy.t('sentTitle')} headingRef={headingRef}>
          <p>{copy.t('sentText')}</p>
        </Panel>
      </Shell>
    );
  }

  if (phase === 'later' && later) {
    return (
      <Shell topRef={topRef} banner={staffBanner}>
        <Panel icon={<Send className="h-7 w-7" />} tone={later.state === 'error' ? 'warn' : 'success'} title={copy.t('laterTitle')} headingRef={headingRef}>
          <p aria-live="polite">
            {later.state === 'error' ? copy.t('laterError') : later.state === 'sent' ? fillText(copy.t('laterText'), { correo: later.email }) : copy.t('saving')}
          </p>
          <Button className="mt-6" variant="secondary" onClick={() => move('wizard')}>{copy.t('laterBack')}</Button>
        </Panel>
      </Shell>
    );
  }

  const childName = ficha?.child_name || String(values.alumno?.child_given_names ?? '');
  if (phase === 'done') {
    return (
      <Shell topRef={topRef} banner={staffBanner}>
        <FichaDone copy={copy} childName={childName} headingRef={headingRef}
          download={session && ficha ? downloadSlot?.({ registrationId: ficha.id, sessionToken: session.token, childName }) : null} />
      </Shell>
    );
  }

  // ── the wizard ─────────────────────────────────────────────────────────
  const step = stepOf(stepKey);
  if (!step) return null;
  const index = order.indexOf(stepKey);
  const sections = completeness?.sections ?? {};
  const stateOf = (key: string, i: number): StepState => {
    if (key === stepKey) return 'current';
    if (key !== FIRMA && sections[key]?.complete && !Object.keys(errors[key] ?? {}).length) return 'done';
    if (i < reached || Object.keys(errors[key] ?? {}).length) return 'missing';
    return 'pending';
  };
  const titleOf = (key: string) => copy.t(TITLE_KEY[key] ?? 'reviewTitle') || stepOf(key)?.title || key;
  /** «Paso 2 de 7» for the numbered steps; none for «Quién llena la ficha». */
  const numberOf = (key: string) => (order.includes(key) ? stepNumber(copy, order.indexOf(key) + 1, order.length) : undefined);
  const items: StepBarItem[] = order.map((key, i) => ({
    key,
    label: titleOf(key),
    state: stateOf(key, i),
    reachable: i <= reached || (key !== FIRMA && !!sections[key]?.complete),
  }));
  const stepErrors = errors[stepKey] ?? {};
  const summaryItems: SummaryItem[] = Object.entries(stepErrors).map(([name, message]) => ({
    id: fieldId(stepKey, name), label: stepField(step, name)?.label ?? name, message,
  }));
  // The review follows the numbered steps; who fills the ficha (unnumbered) comes last.
  const patchKeys = schema.patch_sections ?? [];
  const reviewSections = [...order.filter((k) => patchKeys.includes(k)), ...patchKeys.filter((k) => !order.includes(k))]
    .map((key) => ({ key, title: titleOf(key), number: numberOf(key) }));
  const sectionLabel = (key: string) => {
    const sec = reviewSections.find((x) => x.key === key);
    return sec ? numberedTitle(sec.number, sec.title) : key;
  };
  const incomplete = new Set(Object.entries(sections).filter(([, v]) => !v.complete).map(([k]) => k));
  const isFirma = stepKey === FIRMA;
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void (isFirma ? submit() : next()); };
  const intro = copy.t(INTRO_KEY[stepKey] ?? 'reviewIntro') || step.description;
  const primaryLabel = isFirma ? copy.t('submitLabel') : stepKey === CONTACTO || toReview ? copy.t('reviewReturn') : copy.t('nextLabel');

  let body: ReactNode;
  switch (stepKey) {
    case 'alumno': body = <StepAlumno />; break;
    case 'domicilio': body = <StepDomicilio />; break;
    case 'salud': body = <StepSalud />; break;
    case 'padre':
    case 'madre': body = <StepTutor key={stepKey} prefilled={prefilled[stepKey]} />; break;
    case 'emergencia': body = <StepEmergencia />; break;
    case CONTACTO: body = <StepContacto />; break;
    case FIRMA:
      body = <StepRevision sections={reviewSections} all={values} errors={errors} incomplete={incomplete} onEdit={(k) => go(k, { review: true })} />;
      break;
    default: body = <GenericStep step={step} />;
  }

  return (
    <Shell topRef={topRef} banner={staffBanner}>
      {invitedBanner ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl2 border border-green/30 bg-green-light px-4 py-3 text-[15px] text-ink" role="status">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-green-dark" aria-hidden="true" />
          <p><strong>{copy.t('invitedTitle')}</strong> {copy.t('invitedText')}</p>
        </div>
      ) : null}
      <div className="card p-4 sm:p-8">
        {stepKey !== CONTACTO ? (
          <StepBar key={stepKey} items={items} current={stepKey} copy={copy} onPick={(k) => void leaveTo(k)} intro={intro} headingRef={headingRef} />
        ) : (
          <StepHeading ref={headingRef} title={titleOf(stepKey)} intro={intro} />
        )}
        <ErrorSummary
          ref={summaryRef}
          title={isFirma && submitProblems.length ? copy.t('incompleteTitle') : copy.t('errorSummary')}
          items={summaryItems}
          detail={detail ?? (isFirma && submitProblems.length ? copy.t('incompleteText') : undefined)}
        >
          {isFirma && submitProblems.length ? (
            <ul className="mt-3 space-y-2 sm:pl-7">
              {submitProblems.map((k) => (
                <li key={k} className="flex flex-wrap items-center justify-between gap-x-2 rounded-xl bg-white/70 py-1 pl-3 pr-1 text-sm text-coral-800">
                  <span className="min-w-0 font-semibold">{sectionLabel(k)}</span>
                  <button type="button" className="inline-flex min-h-[44px] items-center rounded-full px-3 font-semibold text-purple underline underline-offset-2 hover:bg-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
                    aria-label={`${copy.t('fixLabel')}: ${sectionLabel(k)}`}
                    onClick={() => go(k, { review: true })}>
                    {copy.t('fixLabel')}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </ErrorSummary>
        <FichaFormProvider value={{ schema, step, values: values[stepKey] ?? {}, errors: stepErrors, set: setField(stepKey), setMany: setFields(stepKey), copy }}>
          <form noValidate onSubmit={onSubmit}>
            {body}
            <div className="mt-8 flex flex-col-reverse gap-4 border-t border-line pt-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {index > 0 || stepKey === CONTACTO ? (
                  <button type="button" onClick={back} disabled={busy}
                    className="btn-outline min-h-[44px] px-5 py-2.5 text-sm disabled:opacity-50">
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {copy.t('backLabel')}
                  </button>
                ) : null}
                <button type="button" onClick={() => void saveForLater()} disabled={busy}
                  className="inline-flex min-h-[44px] items-center rounded-full px-2 text-sm font-semibold text-purple underline underline-offset-4 hover:text-purple-mid focus:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-50">
                  {copy.t('laterLabel')}
                </button>
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                <Button type="submit" variant={isFirma ? 'cta' : 'primary'} size="lg" loading={busy} className="w-full sm:w-auto">
                  {primaryLabel} {isFirma ? null : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                </Button>
                <SaveStatus state={saveState} labels={{ saving: copy.t('saving'), saved: copy.t('saved'), error: copy.t('saveError') }} />
              </div>
            </div>
          </form>
        </FichaFormProvider>
      </div>
    </Shell>
  );
}

/** The page column the ficha lives in (16 px gutters on a phone, never wider than a form should be). */
function Shell({ children, topRef, banner }: { children: ReactNode; topRef: RefObject<HTMLDivElement>; banner?: ReactNode }) {
  return (
    <div ref={topRef} className="mx-auto w-full max-w-2xl scroll-mt-24 px-4 py-6 sm:px-6 sm:py-10">
      {banner}
      {children}
    </div>
  );
}

/** A section the server added and no layout knows yet: its fields in schema order. */
function GenericStep({ step }: { step: FichaStep }) {
  return <div className="space-y-5">{step.fields.filter((f) => !f.read_only).map((f) => <Field key={f.name} name={f.name} />)}</div>;
}
