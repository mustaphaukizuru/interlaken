import { Phone, Mail, MapPin, Clock } from 'lucide-react';

export default function ContactPage() {
  return (
    <div>
      <section className="bg-gradient-to-r from-brand-700 to-brand-600 text-white py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold mb-2">Contacto</h1>
          <p className="text-brand-100">Estamos aquí para responder sus dudas</p>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 grid md:grid-cols-2 gap-10">
        {/* Contact info */}
        <div>
          <h2 className="text-xl font-bold text-slate-900 mb-6">Información de contacto</h2>
          <div className="space-y-5">
            {[
              { icon: Phone,  label: 'Teléfono',        value: '(55) 1234-5678',               href: 'tel:+525512345678' },
              { icon: Mail,   label: 'Correo',           value: 'colegio@interlaken.edu.mx',    href: 'mailto:colegio@interlaken.edu.mx' },
              { icon: MapPin, label: 'Dirección',        value: 'Tlalnepantla de Baz, Estado de México', href: '#' },
              { icon: Clock,  label: 'Horario de oficina', value: 'Lunes–Viernes 8:00–16:00 hrs', href: '#' },
            ].map(({ icon: Icon, label, value, href }) => (
              <a key={label} href={href} className="flex items-start gap-4 group">
                <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-brand-100 transition-colors">
                  <Icon className="w-5 h-5 text-brand-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">{label}</p>
                  <p className="text-sm font-medium text-slate-900">{value}</p>
                </div>
              </a>
            ))}
          </div>

          <div className="mt-8">
            <a
              href="https://wa.me/5215512345678?text=Hola%2C%20me%20gustar%C3%ADa%20obtener%20m%C3%A1s%20informaci%C3%B3n"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-green-500 text-white px-5 py-2.5 rounded-xl font-medium text-sm hover:bg-green-600 transition-colors"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Escribir por WhatsApp
            </a>
          </div>
        </div>

        {/* Contact form */}
        <div className="card">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Envíenos un mensaje</h2>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <div>
              <label className="label">Nombre</label>
              <input className="input-field" placeholder="Su nombre completo" />
            </div>
            <div>
              <label className="label">Correo electrónico</label>
              <input className="input-field" type="email" placeholder="correo@ejemplo.com" />
            </div>
            <div>
              <label className="label">Asunto</label>
              <input className="input-field" placeholder="¿En qué le podemos ayudar?" />
            </div>
            <div>
              <label className="label">Mensaje</label>
              <textarea
                className="input-field min-h-[100px] resize-none"
                placeholder="Describa su consulta…"
              />
            </div>
            <button type="submit" className="btn-primary w-full justify-center">
              Enviar mensaje
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
