import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PrivacyNote } from '@/components/ui/PrivacyNote';
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
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      await admissionsApi.preRegister(data as PreRegistrationData);
      trackEvent(FunnelEvent.SubmitPreRegister, { grade: data.grade_applying });
      setSuccess(true);
    } catch {
      toast.error('Ocurrió un error. Verifique los datos e intente nuevamente.');
    }
  };

  if (success) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-brand-600" />
          </div>
          <h2 className="text-fluid-2xl font-bold text-ink mb-3">¡Pre-registro enviado!</h2>
          <p className="text-muted mb-6">
            Hemos recibido su solicitud. En los próximos 2 días hábiles, un asesor se pondrá en
            contacto con usted para coordinar los siguientes pasos.
          </p>
          <a
            href="/"
            className="btn-primary focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2"
          >
            Volver al inicio
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <section className="relative overflow-hidden bg-dark text-white py-10 sm:py-16">
        <img src="/assets/hopscotch.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <span className="section-label-pink inline-flex">Admisiones</span>
          <h1 className="mt-3 text-fluid-4xl font-bold mb-2">Pre-Registro</h1>
          <p className="text-brand-100 text-fluid-base">Ciclo Escolar 2025–2026</p>
        </div>
      </section>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-6">
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

          <Button type="submit" loading={isSubmitting} size="lg" className="w-full justify-center min-h-[44px]">
            Enviar pre-registro
          </Button>
        </form>
      </div>
    </div>
  );
}
