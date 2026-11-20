/**
 * The /inscripcion wizard (formerly pages/public/RegisterPage), now the locked
 * «Inscripción · Formulario» section (cms/sections/inscripcion.tsx). The
 * steps, fields, rules, the single-use invitation exchange and the uploads are
 * unchanged; every word comes from `copy` (the section's props, edited in
 * Contenido). `onView` tells the page whether the form is showing, so the hero
 * steps aside on the confirmation and the invitation states, as before.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle, ArrowRight, ArrowLeft, UploadCloud, FileText, MailCheck, AlertTriangle } from 'lucide-react';
import { useDraft } from '@/hooks/useDraft';
import { CURRENT_CYCLE } from '@/lib/siteMeta';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import { admissionsApi } from '@/services/api';
import { exchangeOnce } from '@/lib/inviteExchange';

const GRADES = [
  'Preescolar 1°', 'Preescolar 2°', 'Preescolar 3°',
  'Primaria 1°', 'Primaria 2°', 'Primaria 3°', 'Primaria 4°', 'Primaria 5°', 'Primaria 6°',
  'Secundaria 1°', 'Secundaria 2°', 'Secundaria 3°',
];

const deriveLevel = (grade: string): string => {
  const g = grade.toLowerCase();
  if (g.includes('preescolar')) return 'preescolar';
  if (g.includes('secundaria')) return 'secundaria';
  return 'primaria';
};

/** Documents the school asks for: all optional at submit; admissions follows up. Labels are copy. */
const DOC_TYPES: { key: string; prop: string }[] = [
  { key: 'birth_cert',  prop: 'docBirthCert' },
  { key: 'curp_doc',    prop: 'docCurp' },
  { key: 'photo',       prop: 'docPhoto' },
  { key: 'report_card', prop: 'docReportCard' },
  { key: 'proof_addr',  prop: 'docProofAddr' },
];

/** Matches backend ``MAX_DOCUMENT_UPLOAD_SIZE`` (10 MB). */
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOC_EXT = /\.(pdf|jpe?g|png)$/i;

type Form = {
  child_first_name: string; child_last_name: string; child_dob: string;
  child_curp: string; child_nationality: string; grade_applying: string;
  parent1_name: string; parent1_email: string; parent1_phone: string; parent1_occupation: string;
  parent2_name: string; parent2_email: string; parent2_phone: string;
  emergency_name: string; emergency_phone: string; emergency_rel: string;
  blood_type: string; allergies: string; medical_notes: string;
  consent_medical_data: boolean; consent_photos_media: boolean;
};

const EMPTY: Form = {
  child_first_name: '', child_last_name: '', child_dob: '',
  child_curp: '', child_nationality: 'Mexicana', grade_applying: '',
  parent1_name: '', parent1_email: '', parent1_phone: '', parent1_occupation: '',
  parent2_name: '', parent2_email: '', parent2_phone: '',
  emergency_name: '', emergency_phone: '', emergency_rel: '',
  blood_type: '', allergies: '', medical_notes: '',
  consent_medical_data: false, consent_photos_media: false,
};

const selectClass =
  'input-field text-base min-h-[44px] focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-1';

/** `{name}` placeholders of a text → that value; `{nombre}` can render as a node (bold name). */
const fillText = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
function withNode(text: string, key: string, node: ReactNode): ReactNode {
  const parts = text.split(`{${key}}`);
  return parts.map((part, i) => <span key={i}>{i > 0 && node}{part}</span>);
}

export type WizardView = 'form' | 'other';
export interface WizardLink { label?: string; href?: string }

export function RegisterWizard({ c, link, onView }: {
  /** The section's text for a prop name (tokens already replaced). */
  c: (key: string) => string;
  /** The section's link props. */
  link: (key: string) => WizardLink;
  onView?: (view: WizardView) => void;
}) {
  const [params] = useSearchParams();
  const inviteRid = Number(params.get('rid')) || null;
  const inviteToken = params.get('token') || '';
  const isInvited = !!(inviteRid && inviteToken);

  const [step, setStep] = useState(1);
  // Autosave the (text-only) wizard state (BACKLOG P1-I2); invite flows seed from the server instead.
  const draft = useDraft<Form>('inscripcion');
  const [form, setForm] = useState<Form>(() => ({ ...EMPTY, ...(draft.load() ?? {}) }));
  useEffect(() => { draft.save(form); }, [form, draft]);
  const [regId, setRegId] = useState<number | null>(null);
  const [session, setSession] = useState<string>('');
  const [files, setFiles] = useState<Record<string, File>>({});
  const [privacyOk, setPrivacyOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  // Invite flow (#2): booting = exchanging the link's token; inviteError = expired/used.
  const [booting, setBooting] = useState(isInvited);
  const [inviteError, setInviteError] = useState(false);
  const [invited, setInvited] = useState(false);
  // Per-field messages for empty required fields (step 1), shown under each input.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Form, string>>>({});

  // The hero shows only next to the form (before paint, so it never flashes).
  const view: WizardView = success || booting || inviteError ? 'other' : 'form';
  useLayoutEffect(() => { onView?.(view); }, [view, onView]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };

  const hasMedical = !!(form.blood_type || form.allergies || form.medical_notes);
  const docLabel = (key: string) => c(DOC_TYPES.find((d) => d.key === key)?.prop ?? '') || key;

  // ── Invite mode: exchange the admin-issued link for a session + prefill ──
  // The invite token is SINGLE-USE, so this must fire exactly once. A ref guard
  // (not a cleanup ignore-flag) is essential: under StrictMode/double-mount an
  // ignore-flag would still let a second request consume-and-401 the token.
  const exchangeStarted = useRef(false);
  useEffect(() => {
    if (!isInvited || exchangeStarted.current) return;
    exchangeStarted.current = true;
    (async () => {
      try {
        const { data: sess } = await exchangeOnce(inviteRid!, inviteToken);
        const r = sess.registration ?? {};
        setForm((f) => ({
          ...f,
          child_first_name: r.child_first_name || '',
          child_last_name: r.child_last_name || '',
          child_dob: r.child_dob || '',
          child_curp: r.child_curp || '',
          child_nationality: r.child_nationality || 'Mexicana',
          grade_applying: r.grade_applying || '',
          parent1_name: r.parent1_name || '',
          parent1_email: r.parent1_email || '',
          parent1_phone: r.parent1_phone || '',
          parent1_occupation: r.parent1_occupation || '',
          parent2_name: r.parent2_name || '', parent2_email: r.parent2_email || '', parent2_phone: r.parent2_phone || '',
          emergency_name: r.emergency_name || '', emergency_phone: r.emergency_phone || '', emergency_rel: r.emergency_rel || '',
        }));
        setRegId(inviteRid);
        setSession(sess.session_token);
        setInvited(true);
      } catch {
        setInviteError(true);
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step 1: create the registration (or, when invited, save edits) ──────
  async function submitStep1() {
    const required: (keyof Form)[] = [
      'child_first_name', 'child_last_name', 'child_dob',
      'grade_applying', 'parent1_name', 'parent1_email', 'parent1_phone',
    ];
    const errors: Partial<Record<keyof Form, string>> = {};
    for (const k of required) {
      if (!form[k]) errors[k] = c('errRequired');
    }
    setFieldErrors(errors);
    const firstInvalid = required.find((k) => errors[k]);
    if (firstInvalid) {
      toast.error(c('errMissing'));
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    setBusy(true);
    try {
      const step1 = {
        child_first_name: form.child_first_name,
        child_last_name: form.child_last_name,
        child_dob: form.child_dob,
        child_nationality: form.child_nationality || 'Mexicana',
        level: deriveLevel(form.grade_applying),
        grade_applying: form.grade_applying,
        parent1_name: form.parent1_name,
        parent1_email: form.parent1_email,
        parent1_phone: form.parent1_phone,
      };
      if (regId) {
        // Invited: the draft already exists, so persist any corrections.
        await admissionsApi.updateRegistration(regId, step1, session);
      } else {
        const { data } = await admissionsApi.createRegistration({
          ...step1, cycle: CURRENT_CYCLE.replace('–', '-'),
        });
        // Persist id immediately so a failed token exchange does not orphan
        // the draft without a recoverable handle in local state.
        setRegId(data.id);
        const { data: sess } = await admissionsApi.exchangeAccess(data.id, data.invite_token);
        setSession(sess.session_token);
      }
      setStep(2);
    } catch {
      toast.error(c('errStart'));
    } finally {
      setBusy(false);
    }
  }

  // ── Step 2: save the extended details ───────────────────────────────────
  async function saveDetails() {
    if (!regId) return;
    setBusy(true);
    try {
      await admissionsApi.updateRegistration(regId, {
        child_curp: form.child_curp,
        parent1_occupation: form.parent1_occupation,
        parent2_name: form.parent2_name, parent2_email: form.parent2_email, parent2_phone: form.parent2_phone,
        emergency_name: form.emergency_name, emergency_phone: form.emergency_phone, emergency_rel: form.emergency_rel,
      }, session);
      setStep(3);
    } catch {
      toast.error(c('errSave'));
    } finally {
      setBusy(false);
    }
  }

  // ── Step 3: health + consents + documents + submit ──────────────────────
  async function finish() {
    if (!regId) return;
    if (!privacyOk) { toast.error(c('errPrivacy')); return; }
    if (hasMedical && !form.consent_medical_data) {
      toast.error(c('errMedicalConsent'));
      return;
    }
    setBusy(true);
    try {
      await admissionsApi.updateRegistration(regId, {
        blood_type: form.blood_type, allergies: form.allergies, medical_notes: form.medical_notes,
        consent_medical_data: form.consent_medical_data,
        consent_photos_media: form.consent_photos_media,
      }, session);

      const failedDocs: string[] = [];
      for (const [docType, file] of Object.entries(files)) {
        try {
          await admissionsApi.uploadDocument(regId, file, docType, session);
        } catch {
          failedDocs.push(docLabel(docType));
        }
      }
      if (failedDocs.length) {
        toast.error(fillText(c('errUploads'), { documentos: failedDocs.join(', ') }));
        return;
      }

      await admissionsApi.submitRegistration(regId, session, true);
      draft.clear();
      setSuccess(true);
    } catch {
      toast.error(c('errSubmit'));
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    const primary = link('successPrimary');
    const secondary = link('successSecondary');
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="text-center max-w-md" role="status">
          <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-brand-600" aria-hidden="true" />
          </div>
          <h2 className="text-fluid-2xl font-bold text-ink mb-3">{c('successTitle')}</h2>
          <p className="text-muted mb-6">
            {withNode(c('successText'), 'nombre', <strong>{form.child_first_name}</strong>)}
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            {primary.href && (
              <Link
                to={primary.href}
                className="btn-primary focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2"
              >
                {primary.label}
              </Link>
            )}
            {secondary.href && (
              <Link
                to={secondary.href}
                className="btn-outline focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2"
              >
                {secondary.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Invite link is being exchanged for a session: brief, blocking state.
  if (booting) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="text-center text-muted">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-line border-t-purple" />
          {c('booting')}
        </div>
      </div>
    );
  }

  // Invite token expired, already used, or invalid.
  if (inviteError) {
    const retry = link('inviteErrorLink');
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-coral/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-coral-dark" />
          </div>
          <h2 className="text-fluid-2xl font-bold text-ink mb-3">{c('inviteErrorTitle')}</h2>
          <p className="text-muted mb-6">
            {c('inviteErrorText')}
          </p>
          {retry.href && (
            <Link to={retry.href} className="btn-primary focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2">
              {retry.label}
            </Link>
          )}
        </div>
      </div>
    );
  }

  const STEPS = [c('step1'), c('step2'), c('step3')];
  const footer = link('footerLink');

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {invited && (
        <div className="mb-6 flex items-start gap-3 rounded-xl2 border border-brand-600/25 bg-brand-50 px-4 py-3">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
          <p className="text-sm text-ink">
            <strong>{c('invitedTitle')}</strong> {c('invitedText')}
          </p>
        </div>
      )}

      {/* Stepper */}
      <ol className="mb-8 flex items-center gap-2" aria-label={c('stepsLabel')}>
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < step ? 'done' : n === step ? 'current' : 'todo';
          return (
            <li key={n} className="flex flex-1 items-center gap-2">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                state === 'done' ? 'bg-brand-600 text-white'
                : state === 'current' ? 'bg-purple text-white'
                : 'bg-cream text-subtle'
              }`}>{state === 'done' ? '✓' : n}</span>
              <span className={`hidden text-xs font-medium sm:block ${n === step ? 'text-ink' : 'text-subtle'}`}>{label}</span>
              {n < STEPS.length && <span className="h-px flex-1 bg-line" />}
            </li>
          );
        })}
      </ol>

      <div className="card space-y-6">
        {step === 1 && (
          <>
            <SectionHead title={c('studentTitle')} subtitle={c('studentSubtitle')} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input id="child_first_name" label={c('firstNameLabel')} error={fieldErrors.child_first_name} className="text-base min-h-[44px]" value={form.child_first_name} onChange={(e) => set('child_first_name', e.target.value)} />
              <Input id="child_last_name" label={c('lastNameLabel')} error={fieldErrors.child_last_name} className="text-base min-h-[44px]" value={form.child_last_name} onChange={(e) => set('child_last_name', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input id="child_dob" label={c('dobLabel')} type="date" max={new Date().toISOString().slice(0, 10)} error={fieldErrors.child_dob} className="text-base min-h-[44px]" value={form.child_dob} onChange={(e) => set('child_dob', e.target.value)} />
              <div>
                <label htmlFor="grade_applying" className="label">{c('gradeLabel')}</label>
                <select
                  id="grade_applying"
                  className={selectClass}
                  value={form.grade_applying}
                  onChange={(e) => set('grade_applying', e.target.value)}
                  aria-invalid={fieldErrors.grade_applying ? true : undefined}
                  aria-describedby={fieldErrors.grade_applying ? 'grade_applying-error' : undefined}
                >
                  <option value="">{c('selectPlaceholder')}</option>
                  {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                {fieldErrors.grade_applying && (
                  <p id="grade_applying-error" className="mt-1.5 text-xs text-coral-600">{fieldErrors.grade_applying}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input id="child_curp" label={c('curpLabel')} className="text-base min-h-[44px]" value={form.child_curp} onChange={(e) => set('child_curp', e.target.value)} />
              <Input id="child_nationality" label={c('nationalityLabel')} className="text-base min-h-[44px]" value={form.child_nationality} onChange={(e) => set('child_nationality', e.target.value)} />
            </div>

            <hr className="border-line" />
            <SectionHead title={c('parentTitle')} subtitle={c('parentSubtitle')} />
            <Input id="parent1_name" label={c('parentNameLabel')} error={fieldErrors.parent1_name} className="text-base min-h-[44px]" value={form.parent1_name} onChange={(e) => set('parent1_name', e.target.value)} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input id="parent1_email" label={c('emailLabel')} type="email" inputMode="email" autoComplete="email" error={fieldErrors.parent1_email} className="text-base min-h-[44px]" value={form.parent1_email} onChange={(e) => set('parent1_email', e.target.value)} />
              <Input id="parent1_phone" label={c('phoneLabel')} type="tel" inputMode="tel" autoComplete="tel" error={fieldErrors.parent1_phone} className="text-base min-h-[44px]" value={form.parent1_phone} onChange={(e) => set('parent1_phone', e.target.value)} />
            </div>

            <div className="flex justify-end">
              <Button onClick={submitStep1} loading={busy} size="lg" className="min-h-[44px] justify-center">
                {c('nextLabel')} <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <SectionHead title={c('moreTitle')} subtitle={c('moreSubtitle')} />
            <Input id="parent1_occupation" label={c('occupationLabel')} className="text-base min-h-[44px]" value={form.parent1_occupation} onChange={(e) => set('parent1_occupation', e.target.value)} />

            <hr className="border-line" />
            <SectionHead title={c('parent2Title')} />
            <Input id="parent2_name" label={c('parent2NameLabel')} className="text-base min-h-[44px]" value={form.parent2_name} onChange={(e) => set('parent2_name', e.target.value)} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input id="parent2_email" label={c('parent2EmailLabel')} type="email" inputMode="email" autoComplete="email" className="text-base min-h-[44px]" value={form.parent2_email} onChange={(e) => set('parent2_email', e.target.value)} />
              <Input id="parent2_phone" label={c('parent2PhoneLabel')} type="tel" inputMode="tel" autoComplete="tel" className="text-base min-h-[44px]" value={form.parent2_phone} onChange={(e) => set('parent2_phone', e.target.value)} />
            </div>

            <hr className="border-line" />
            <SectionHead title={c('emergencyTitle')} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input id="emergency_name" label={c('emergencyNameLabel')} className="text-base min-h-[44px]" value={form.emergency_name} onChange={(e) => set('emergency_name', e.target.value)} />
              <Input id="emergency_phone" label={c('emergencyPhoneLabel')} type="tel" inputMode="tel" autoComplete="tel" className="text-base min-h-[44px]" value={form.emergency_phone} onChange={(e) => set('emergency_phone', e.target.value)} />
            </div>
            <Input id="emergency_rel" label={c('emergencyRelLabel')} className="text-base min-h-[44px]" value={form.emergency_rel} onChange={(e) => set('emergency_rel', e.target.value)} />

            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(1)} className="min-h-[44px]"><ArrowLeft className="w-4 h-4" /> {c('backLabel')}</Button>
              <Button onClick={saveDetails} loading={busy} className="min-h-[44px]">{c('nextLabel')} <ArrowRight className="w-4 h-4" /></Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <SectionHead title={c('healthTitle')} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input id="blood_type" label={c('bloodLabel')} className="text-base min-h-[44px]" value={form.blood_type} onChange={(e) => set('blood_type', e.target.value)} />
              <Input id="allergies" label={c('allergiesLabel')} className="text-base min-h-[44px] sm:col-span-2" value={form.allergies} onChange={(e) => set('allergies', e.target.value)} />
            </div>
            <div>
              <label htmlFor="medical" className="label">{c('medicalLabel')}</label>
              <textarea id="medical" className="input-field text-base min-h-[80px] resize-none" value={form.medical_notes} onChange={(e) => set('medical_notes', e.target.value)} />
            </div>
            {hasMedical && (
              <Check label={c('consentMedical')} checked={form.consent_medical_data} onChange={(v) => set('consent_medical_data', v)} />
            )}

            <hr className="border-line" />
            <SectionHead title={c('docsTitle')} subtitle={c('docsSubtitle')} />
            <div className="space-y-2">
              {DOC_TYPES.map((d) => (
                <FileRow key={d.key} docKey={d.key} label={docLabel(d.key)} file={files[d.key]} c={c}
                  onPick={(f) => setFiles((prev) => ({ ...prev, [d.key]: f }))}
                  onClear={() => setFiles((prev) => { const n = { ...prev }; delete n[d.key]; return n; })} />
              ))}
            </div>

            <hr className="border-line" />
            <Check label={c('consentPhotos')} checked={form.consent_photos_media} onChange={(v) => set('consent_photos_media', v)} />
            <PrivacyNote />
            <Check label={c('privacyAccept')} checked={privacyOk} onChange={setPrivacyOk} />

            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(2)} className="min-h-[44px]"><ArrowLeft className="w-4 h-4" /> {c('backLabel')}</Button>
              <Button onClick={finish} loading={busy} size="lg" className="min-h-[44px]">{c('submitLabel')}</Button>
            </div>
          </>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-subtle">
        {c('footerText')}{' '}
        {footer.href && <Link to={footer.href} className="font-semibold text-purple hover:underline">{footer.label}</Link>}
      </p>
    </div>
  );
}

function SectionHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="font-semibold text-fluid-lg text-ink mb-1">{title}</h2>
      {subtitle && <p className="text-xs text-subtle">{subtitle}</p>}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[44px] items-center gap-3 text-sm text-muted">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 rounded border-line text-purple focus-visible:ring-2 focus-visible:ring-purple/40" />
      <span>{label}</span>
    </label>
  );
}

function FileRow({ docKey, label, file, onPick, onClear, c }: {
  docKey: string; label: string; file?: File; onPick: (f: File) => void; onClear: () => void; c: (key: string) => string;
}) {
  // A stable id per document type (the label is editable text).
  const id = `doc-${docKey}`;
  const pick = (f: File) => {
    if (!ALLOWED_DOC_EXT.test(f.name)) {
      toast.error(fillText(c('errFileType'), { documento: label }));
      return;
    }
    if (f.size > MAX_DOC_BYTES) {
      toast.error(fillText(c('errFileSize'), { documento: label }));
      return;
    }
    onPick(f);
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
        <FileText className="h-4 w-4 shrink-0 text-subtle" />
        <span className="truncate">{file ? file.name : label}</span>
      </span>
      {file ? (
        <button type="button" onClick={onClear} className="inline-flex min-h-[44px] shrink-0 items-center text-xs font-semibold text-coral-dark hover:underline">{c('removeLabel')}</button>
      ) : (
        <label htmlFor={id} className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-cream px-3 py-1.5 text-xs font-semibold text-ink hover:bg-line">
          <UploadCloud className="h-3.5 w-3.5" /> {c('attachLabel')}
          <input id={id} type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) pick(f);
            }} />
        </label>
      )}
    </div>
  );
}

export default RegisterWizard;
