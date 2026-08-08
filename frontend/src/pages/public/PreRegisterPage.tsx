import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
import { FunnelHero } from '@/components/admissions/FunnelHero';
import { admissionsApi } from '@/services/api';
import { trackEvent, FunnelEvent } from '@/services/analytics';
import type { PreRegistrationData } from '@/types';

const schema = z.object({
  child_name:       z.string().min(2, 'Nombre requerido'),
  child_dob:        z.string().min(1, 'Fecha de nacimiento requerida'),
  grade_applying:   z.string().min(1, 'Seleccione un nivel'),
  parent_name:      z.string().min(2, 'Nombre del tutor requerido'),
  email:            z.string().email('Correo electrónico inválido'),
  phone:            z.string().min(10, 'Teléfono inválido'),
  how_did_you_hear: z.string().optional(),
  message:          z.string().optional(),
});

type FormData = z.infer<typeof schema>;

const GRADES = [
  'Preescolar 1°', 'Preescolar 2°', 'Preescolar 3°',
  'Primaria 1°', 'Primaria 2°', 'Primaria 3°', 'Primaria 4°', 'Primaria 5°', 'Primaria 6°',
  'Secundaria 1°', 'Secundaria 2°', 'Secundaria 3°',
];

// Full-width, ≥16px inputs prevent iOS zoom on focus; brand focus-visible ring.
const selectClass =
  'input-field text-base min-h-[44px] focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-1';

export default function PreRegisterPage() {
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setSubmitError(null);
    try {
      await admissionsApi.preRegister(data as PreRegistrationData);
      trackEvent(FunnelEvent.SubmitPreRegister, { grade: data.grade_applying });
      setSuccess(true);
    } catch {
      const msg = 'No pudimos enviar el pre-registro. Verifique los datos e intente nuevamente.';
      setSubmitError(msg);
      toast.error(msg);
    }
  };

  if (success) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="text-center max-w-md" role="status">
          <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-brand-600" aria-hidden="true" />
          </div>
          <h2 className="text-fluid-2xl font-bold text-ink mb-3">¡Pre-registro enviado!</h2>
          <p className="text-muted mb-6">
            Hemos recibido su solicitud. En los próximos 2 días hábiles, un asesor se pondrá en
            contacto con usted para coordinar los siguientes pasos.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              to="/admisiones"
              className="btn-primary focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2"
            >
              Ver proceso de admisión
            </Link>
            <Link
              to="/contacto"
              className="btn-outline focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2"
            >
              Contactar al colegio
            </Link>
          </div>
          <p className="mt-6 text-sm text-subtle">
            Si ya tiene cuenta de padres, puede consultar el estado de su inscripción en el{' '}
            <Link to="/login" className="font-semibold text-green-dark underline">
              portal
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <FunnelHero
        step="pre-registro"
        title="Pre-Registro"
        subtitle="Menos de 5 minutos. Recibirá confirmación inmediata y un asesor le contactará en 2 días hábiles."
      />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-6" noValidate>
          {submitError && (
            <div
              className="flex items-start gap-3 rounded-xl2 border border-coral/30 bg-coral-50 px-4 py-3 text-sm text-coral-dark"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{submitError}</p>
            </div>
          )}
          <div>
            <h2 className="font-semibold text-fluid-lg text-ink mb-1">Datos del alumno</h2>
            <p className="text-xs text-subtle">Información del candidato a inscripción</p>
          </div>

          <Input
            label="Nombre completo del alumno"
            placeholder="Ej. Ana María González Pérez"
            error={errors.child_name?.message}
            className="text-base min-h-[44px]"
            {...register('child_name')}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Fecha de nacimiento"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              error={errors.child_dob?.message}
              className="text-base min-h-[44px]"
              {...register('child_dob')}
            />
            <div>
              <label htmlFor="grade_applying" className="label">Grado al que aplica</label>
              <select id="grade_applying" className={selectClass} {...register('grade_applying')}>
                <option value="">Seleccionar…</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              {errors.grade_applying && (
                <p className="mt-1.5 text-xs text-red-600">{errors.grade_applying.message}</p>
              )}
            </div>
          </div>

          <hr className="border-line" />

          <div>
            <h2 className="font-semibold text-fluid-lg text-ink mb-1">Datos del tutor</h2>
            <p className="text-xs text-subtle">Información de contacto del padre/madre/tutor</p>
          </div>

          <Input
            label="Nombre completo del tutor"
            placeholder="Ej. Roberto González Sánchez"
            error={errors.parent_name?.message}
            className="text-base min-h-[44px]"
            {...register('parent_name')}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Correo electrónico"
              type="email"
              placeholder="correo@ejemplo.com"
              error={errors.email?.message}
              className="text-base min-h-[44px]"
              {...register('email')}
            />
            <Input
              label="Teléfono / WhatsApp"
              type="tel"
              placeholder="55 1234 5678"
              error={errors.phone?.message}
              className="text-base min-h-[44px]"
              {...register('phone')}
            />
          </div>

          <div>
            <label htmlFor="how_did_you_hear" className="label">¿Cómo se enteró de nosotros?</label>
            <select id="how_did_you_hear" className={selectClass} {...register('how_did_you_hear')}>
              <option value="">Seleccionar…</option>
              <option value="referido">Recomendación de familia/amigo</option>
              <option value="redes">Redes sociales</option>
              <option value="google">Búsqueda en Google</option>
              <option value="espectacular">Espectacular / Anuncio</option>
              <option value="otro">Otro</option>
            </select>
          </div>

          <div>
            <label htmlFor="message" className="label">Mensaje adicional (opcional)</label>
            <textarea
              id="message"
              className="input-field text-base min-h-[96px] resize-none focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-1"
              placeholder="Dudas, necesidades especiales, o información que desee compartir…"
              {...register('message')}
            />
          </div>

          <PrivacyNote />

          <Button type="submit" variant="cta" loading={isSubmitting} size="lg" className="w-full justify-center">
            Enviar pre-registro
          </Button>
        </form>
      </div>
    </div>
  );
}
