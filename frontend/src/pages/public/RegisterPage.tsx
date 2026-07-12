import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle, ArrowRight, ArrowLeft, UploadCloud, FileText } from 'lucide-react';
import { CURRENT_CYCLE } from '@/lib/siteMeta';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import { admissionsApi } from '@/services/api';

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

/** Documents the school asks for — all optional at submit; admissions follows up. */
const DOC_TYPES: { key: string; label: string }[] = [
  { key: 'birth_cert',  label: 'Acta de Nacimiento' },
  { key: 'curp_doc',    label: 'CURP' },
  { key: 'photo',       label: 'Fotografía' },
  { key: 'report_card', label: 'Boleta Anterior' },
  { key: 'proof_addr',  label: 'Comprobante de Domicilio' },
];

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

export default function RegisterPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Form>(EMPTY);
  const [regId, setRegId] = useState<number | null>(null);
  const [session, setSession] = useState<string>('');
  const [files, setFiles] = useState<Record<string, File>>({});
  const [privacyOk, setPrivacyOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const hasMedical = !!(form.blood_type || form.allergies || form.medical_notes);

  // ── Step 1: create the registration + open a session ────────────────────
  async function startRegistration() {
    if (!form.child_first_name || !form.child_last_name || !form.child_dob ||
        !form.grade_applying || !form.parent1_name || !form.parent1_email || !form.parent1_phone) {
      toast.error('Complete los campos obligatorios.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await admissionsApi.createRegistration({
        child_first_name: form.child_first_name,
        child_last_name: form.child_last_name,
        child_dob: form.child_dob,
        child_nationality: form.child_nationality || 'Mexicana',
        level: deriveLevel(form.grade_applying),
        grade_applying: form.grade_applying,
        cycle: CURRENT_CYCLE.replace('–', '-'),
        parent1_name: form.parent1_name,
        parent1_email: form.parent1_email,
        parent1_phone: form.parent1_phone,
      });
      const { data: sess } = await admissionsApi.exchangeAccess(data.id, data.invite_token);
      setRegId(data.id);
      setSession(sess.session_token);
      setStep(2);
    } catch {
      toast.error('No se pudo iniciar la inscripción. Verifique los datos.');
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
      toast.error('No se pudieron guardar los datos. Intente de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  // ── Step 3: health + consents + documents + submit ──────────────────────
  async function finish() {
    if (!regId) return;
    if (!privacyOk) { toast.error('Debe aceptar el Aviso de Privacidad.'); return; }
    if (hasMedical && !form.consent_medical_data) {
      toast.error('Marque el consentimiento de datos de salud para enviar información médica.');
      return;
    }
    setBusy(true);
    try {
      await admissionsApi.updateRegistration(regId, {
        blood_type: form.blood_type, allergies: form.allergies, medical_notes: form.medical_notes,
        consent_medical_data: form.consent_medical_data,
        consent_photos_media: form.consent_photos_media,
      }, session);

      for (const [docType, file] of Object.entries(files)) {
        await admissionsApi.uploadDocument(regId, file, docType, session);
      }

      await admissionsApi.submitRegistration(regId, session, true);
      setSuccess(true);
    } catch {
      toast.error('No se pudo enviar la inscripción. Intente de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-brand-600" />
          </div>
          <h2 className="text-fluid-2xl font-bold text-ink mb-3">¡Inscripción enviada!</h2>
          <p className="text-muted mb-6">
            Hemos recibido la documentación de inscripción de <strong>{form.child_first_name}</strong>.
            El equipo de admisiones la revisará y le informará en un plazo de 3 a 5 días hábiles.
          </p>
          <Link to="/" className="btn-primary focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2">
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  const STEPS = ['Alumno y tutor', 'Datos adicionales', 'Salud y documentos'];

  return (
    <div>
      <section className="relative overflow-hidden bg-dark text-white py-10 sm:py-16">
        <img src="/assets/court-primaria.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <span className="section-label-pink inline-flex">Admisiones</span>
          <h1 className="mt-3 text-fluid-4xl font-bold mb-2">Inscripción en línea</h1>
          <p className="text-brand-100 text-fluid-base">Ciclo Escolar {CURRENT_CYCLE}</p>
        </div>
      </section>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Stepper */}
        <ol className="mb-8 flex items-center gap-2" aria-label="Progreso de inscripción">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const state = n < step ? 'done' : n === step ? 'current' : 'todo';
            return (
              <li key={label} className="flex flex-1 items-center gap-2">
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
              <SectionHead title="Datos del alumno" subtitle="Información del candidato a inscripción" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Nombre(s)" className="text-base min-h-[44px]" value={form.child_first_name} onChange={(e) => set('child_first_name', e.target.value)} />
                <Input label="Apellidos" className="text-base min-h-[44px]" value={form.child_last_name} onChange={(e) => set('child_last_name', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Fecha de nacimiento" type="date" className="text-base min-h-[44px]" value={form.child_dob} onChange={(e) => set('child_dob', e.target.value)} />
                <div>
                  <label htmlFor="grade" className="label">Grado al que aplica</label>
                  <select id="grade" className={selectClass} value={form.grade_applying} onChange={(e) => set('grade_applying', e.target.value)}>
                    <option value="">Seleccionar…</option>
                    {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="CURP (opcional)" className="text-base min-h-[44px]" value={form.child_curp} onChange={(e) => set('child_curp', e.target.value)} />
                <Input label="Nacionalidad" className="text-base min-h-[44px]" value={form.child_nationality} onChange={(e) => set('child_nationality', e.target.value)} />
              </div>

              <hr className="border-line" />
              <SectionHead title="Tutor principal" subtitle="Padre, madre o tutor" />
              <Input label="Nombre completo del tutor" className="text-base min-h-[44px]" value={form.parent1_name} onChange={(e) => set('parent1_name', e.target.value)} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Correo electrónico" type="email" className="text-base min-h-[44px]" value={form.parent1_email} onChange={(e) => set('parent1_email', e.target.value)} />
                <Input label="Teléfono / WhatsApp" type="tel" className="text-base min-h-[44px]" value={form.parent1_phone} onChange={(e) => set('parent1_phone', e.target.value)} />
              </div>

              <div className="flex justify-end">
                <Button onClick={startRegistration} loading={busy} size="lg" className="min-h-[44px] justify-center">
                  Siguiente <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <SectionHead title="Datos adicionales del tutor" subtitle="Opcional — puede completarlos ahora o después" />
              <Input label="Ocupación del tutor" className="text-base min-h-[44px]" value={form.parent1_occupation} onChange={(e) => set('parent1_occupation', e.target.value)} />

              <hr className="border-line" />
              <SectionHead title="Segundo tutor (opcional)" />
              <Input label="Nombre completo" className="text-base min-h-[44px]" value={form.parent2_name} onChange={(e) => set('parent2_name', e.target.value)} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Correo electrónico" type="email" className="text-base min-h-[44px]" value={form.parent2_email} onChange={(e) => set('parent2_email', e.target.value)} />
                <Input label="Teléfono" type="tel" className="text-base min-h-[44px]" value={form.parent2_phone} onChange={(e) => set('parent2_phone', e.target.value)} />
              </div>

              <hr className="border-line" />
              <SectionHead title="Contacto de emergencia (opcional)" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Nombre" className="text-base min-h-[44px]" value={form.emergency_name} onChange={(e) => set('emergency_name', e.target.value)} />
                <Input label="Teléfono" type="tel" className="text-base min-h-[44px]" value={form.emergency_phone} onChange={(e) => set('emergency_phone', e.target.value)} />
              </div>
              <Input label="Parentesco" className="text-base min-h-[44px]" value={form.emergency_rel} onChange={(e) => set('emergency_rel', e.target.value)} />

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep(1)} className="min-h-[44px]"><ArrowLeft className="w-4 h-4" /> Atrás</Button>
                <Button onClick={saveDetails} loading={busy} className="min-h-[44px]">Siguiente <ArrowRight className="w-4 h-4" /></Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <SectionHead title="Información de salud (opcional)" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input label="Tipo de sangre" className="text-base min-h-[44px]" value={form.blood_type} onChange={(e) => set('blood_type', e.target.value)} />
                <Input label="Alergias" className="text-base min-h-[44px] sm:col-span-2" value={form.allergies} onChange={(e) => set('allergies', e.target.value)} />
              </div>
              <div>
                <label htmlFor="medical" className="label">Notas médicas</label>
                <textarea id="medical" className="input-field text-base min-h-[80px] resize-none" value={form.medical_notes} onChange={(e) => set('medical_notes', e.target.value)} />
              </div>
              {hasMedical && (
                <Check label="Autorizo el tratamiento de los datos de salud proporcionados." checked={form.consent_medical_data} onChange={(v) => set('consent_medical_data', v)} />
              )}

              <hr className="border-line" />
              <SectionHead title="Documentos" subtitle="Adjunte los que tenga disponibles (PDF o imagen). Puede completarlos después." />
              <div className="space-y-2">
                {DOC_TYPES.map((d) => (
                  <FileRow key={d.key} label={d.label} file={files[d.key]}
                    onPick={(f) => setFiles((prev) => ({ ...prev, [d.key]: f }))}
                    onClear={() => setFiles((prev) => { const n = { ...prev }; delete n[d.key]; return n; })} />
                ))}
              </div>

              <hr className="border-line" />
              <Check label="Autorizo el uso de fotografías y material audiovisual con fines institucionales." checked={form.consent_photos_media} onChange={(v) => set('consent_photos_media', v)} />
              <PrivacyNote />
              <Check label="He leído y acepto el Aviso de Privacidad." checked={privacyOk} onChange={setPrivacyOk} />

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep(2)} className="min-h-[44px]"><ArrowLeft className="w-4 h-4" /> Atrás</Button>
                <Button onClick={finish} loading={busy} size="lg" className="min-h-[44px]">Enviar inscripción</Button>
              </div>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-subtle">
          ¿Aún no ha hecho su pre-registro?{' '}
          <Link to="/pre-registro" className="font-semibold text-purple hover:underline">Inicie aquí</Link>
        </p>
      </div>
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
    <label className="flex items-start gap-3 text-sm text-muted">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-purple focus-visible:ring-2 focus-visible:ring-purple/40" />
      <span>{label}</span>
    </label>
  );
}

function FileRow({ label, file, onPick, onClear }: {
  label: string; file?: File; onPick: (f: File) => void; onClear: () => void;
}) {
  const id = `doc-${label.replace(/\s+/g, '-')}`;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
        <FileText className="h-4 w-4 shrink-0 text-subtle" />
        <span className="truncate">{file ? file.name : label}</span>
      </span>
      {file ? (
        <button type="button" onClick={onClear} className="shrink-0 text-xs font-semibold text-coral-dark hover:underline">Quitar</button>
      ) : (
        <label htmlFor={id} className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-cream px-3 py-1.5 text-xs font-semibold text-ink hover:bg-line">
          <UploadCloud className="h-3.5 w-3.5" /> Adjuntar
          <input id={id} type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }} />
        </label>
      )}
    </div>
  );
}
