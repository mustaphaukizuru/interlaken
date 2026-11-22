import { Lightbulb, X } from 'lucide-react';

/** «Cómo editar una página»: four steps for a first visit to the editor. */
export function EditorOnboarding({ onDismiss, canPublish }: { onDismiss: () => void; canPublish: boolean }) {
  const steps: [string, string][] = [
    ['Elija una sección', 'Haga clic en ella en la vista previa o en la lista «Secciones».'],
    ['Cambie textos y fotos', 'El formulario guarda solo en el borrador. «Deshacer» revierte el último cambio.'],
    ['Revise', '«Revisar» busca errores y «Vista previa» abre la página completa, como la verán las familias.'],
    canPublish
      ? ['Publique', '«Publicar» la pone en el sitio. Hasta entonces nadie ve sus cambios, y cada publicación queda en «Versiones».']
      : ['Pida aprobación', '«Solicitar aprobación» avisa a Dirección, que la publica. Hasta entonces nadie ve sus cambios.'],
  ];
  return (
    <section aria-labelledby="cms-onboarding-title" className="relative rounded-md bg-white p-4 pr-12 shadow-card">
      <h2 id="cms-onboarding-title" className="mb-3 flex items-center gap-2 font-semibold text-ink">
        <Lightbulb size={18} className="text-amber" aria-hidden="true" /> Cómo editar una página
      </h2>
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map(([title, text], i) => (
          <li key={title} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple text-xs font-bold text-white" aria-hidden="true">{i + 1}</span>
            <span className="text-sm"><strong className="block text-ink">{title}</strong><span className="text-muted">{text}</span></span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={onDismiss} aria-label="Cerrar la guía «Cómo editar una página»"
        className="absolute right-1.5 top-1.5 inline-flex h-11 w-11 items-center justify-center rounded-sm text-subtle hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40">
        <X size={18} aria-hidden="true" />
      </button>
    </section>
  );
}
