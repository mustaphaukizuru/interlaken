import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
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
  'Preparatoria 1°', 'Preparatoria 2°', 'Preparatoria 3°',
];

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
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-brand-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">¡Pre-registro enviado!</h2>
          <p className="text-slate-500 mb-6">
            Hemos recibido su solicitud. En los próximos 2 días hábiles, un asesor se pondrá en
            contacto con usted para coordinar los siguientes pasos.
          </p>
          <a href="/" className="btn-primary">Volver al inicio</a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <section className="bg-gradient-to-r from-brand-700 to-brand-600 text-white py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold mb-2">Pre-Registro</h1>
          <p className="text-brand-100">Ciclo Escolar 2025–2026</p>
        </div>
      </section>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <form onSubmit={handleSubmit(onSubmit)} className="card space-y-6">
          <div>
            <h2 className="font-semibold text-slate-900 mb-1">Datos del alumno</h2>
            <p className="text-xs text-slate-500">Información del candidato a inscripción</p>
          </div>

          <Input
            label="Nombre completo del alumno"
            placeholder="Ej. Ana María González Pérez"
            error={errors.child_name?.message}
            {...register('child_name')}
          />

          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Fecha de nacimiento"
              type="date"
              error={errors.child_dob?.message}
              {...register('child_dob')}
            />
            <div>
              <label className="label">Grado al que aplica</label>
              <select className="input-field" {...register('grade_applying')}>
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

          <hr className="border-slate-100" />

          <div>
            <h2 className="font-semibold text-slate-900 mb-1">Datos del tutor</h2>
            <p className="text-xs text-slate-500">Información de contacto del padre/madre/tutor</p>
          </div>

          <Input
            label="Nombre completo del tutor"
            placeholder="Ej. Roberto González Sánchez"
            error={errors.parent_name?.message}
            {...register('parent_name')}
          />

          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Correo electrónico"
              type="email"
              placeholder="correo@ejemplo.com"
              error={errors.email?.message}
              {...register('email')}
            />
            <Input
              label="Teléfono / WhatsApp"
              type="tel"
              placeholder="55 1234 5678"
              error={errors.phone?.message}
              {...register('phone')}
            />
          </div>

          <div>
            <label className="label">¿Cómo se enteró de nosotros?</label>
            <select className="input-field" {...register('how_did_you_hear')}>
              <option value="">Seleccionar…</option>
              <option value="referido">Recomendación de familia/amigo</option>
              <option value="redes">Redes sociales</option>
              <option value="google">Búsqueda en Google</option>
              <option value="espectacular">Espectacular / Anuncio</option>
              <option value="otro">Otro</option>
            </select>
          </div>

          <div>
            <label className="label">Mensaje adicional (opcional)</label>
            <textarea
              className="input-field min-h-[80px] resize-none"
              placeholder="Dudas, necesidades especiales, o información que desee compartir…"
              {...register('message')}
            />
          </div>

          <Button type="submit" loading={isSubmitting} size="lg" className="w-full justify-center">
            Enviar Pre-Registro
          </Button>
        </form>
      </div>
    </div>
  );
}
