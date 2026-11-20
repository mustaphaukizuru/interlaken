/**
 * Inscripción (/inscripcion): the invitation wizard as a CMS page
 * (docs/cms/full-coverage.md). The hero is a normal section; the wizard is a
 * locked section (components/admissions/RegisterWizard) whose every word is a
 * prop. Its steps, fields, rules, uploads and the single-use invitation link
 * are unchanged. While the wizard shows its confirmation or an invitation
 * state the hero steps aside, as before (a page-local flag, like Pre-registro).
 */
import { useCallback, useSyncExternalStore } from 'react';
import { FunnelHero } from '@/components/admissions/FunnelHero';
import { RegisterWizard, type WizardView } from '@/components/admissions/RegisterWizard';
import { useCmsImage, useTokens, type CmsLink } from '../runtime';
import { asLink, defineModule, f, inGroup, sectionsOf } from './kit';

const section = sectionsOf('inscripcion');

/* ── «Is the form showing?» flag shared by the sections of this page ────── */
let view: WizardView = 'form';
const listeners = new Set<() => void>();
function setView(v: WizardView) {
  if (view === v) return;
  view = v;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const useView = () => useSyncExternalStore(subscribe, () => view, () => 'form' as WizardView);

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; subtitle?: string; image?: number | string }
function InscripcionHeroView(p: HeroProps) {
  const t = useTokens();
  const img = useCmsImage(p.image);
  if (useView() !== 'form') return null;
  return (
    <FunnelHero
      step="inscripcion"
      label={t(p.label)}
      title={t(p.title)}
      subtitle={p.subtitle ? t(p.subtitle) : undefined}
      imageSrc={img.src || undefined}
    />
  );
}

/* ── Formulario (bloqueado) ─────────────────────────────────────────────── */
function InscripcionWizardView(p: Record<string, unknown>) {
  const t = useTokens();
  const c = useCallback((key: string) => t(p[key]), [p, t]);
  const link = useCallback((key: string): CmsLink => { const l = asLink(p[key]); return { ...l, label: t(l.label) }; }, [p, t]);
  return <RegisterWizard c={c} link={link} onView={setView} />;
}

export const sections = [
  section({
    type: 'hero', label: 'Inscripción · Portada', description: 'Portada oscura con foto, título, subtítulo y los pasos del proceso de admisión. Se oculta en la confirmación y en los avisos de invitación.',
    component: InscripcionHeroView,
    fields: [f.text('label', 'Etiqueta superior', { hint: 'Puede usar {{ciclo}}.' }), f.text('title', 'Título', { required: true }), f.textarea('subtitle', 'Subtítulo', { hint: 'Puede usar {{ciclo}}.' }), f.image('image', 'Foto de fondo')],
    defaults: {
      label: 'Ciclo Escolar {{ciclo}} · Admisiones', title: 'Inscripción en línea',
      subtitle: 'Ciclo Escolar {{ciclo}}. Complete los datos del alumno, adjunte documentos y envíe su solicitud.',
      image: '/assets/court-primaria.webp',
    },
  }),
  section({
    type: 'wizard', label: 'Inscripción · Formulario', locked: true,
    description: 'El formulario de inscripción en tres pasos, también el que abre el enlace de invitación de Admisiones. Aquí se editan todos sus textos; los pasos, los campos, los grados y las reglas no cambian.',
    component: InscripcionWizardView,
    fields: [
      ...inGroup('Pasos y botones', [
        f.text('step1', 'Paso 1'), f.text('step2', 'Paso 2'), f.text('step3', 'Paso 3'),
        f.text('stepsLabel', 'Nombre de los pasos (lectores de pantalla)'),
        f.text('nextLabel', 'Botón «Siguiente»'), f.text('backLabel', 'Botón «Atrás»'), f.text('submitLabel', 'Botón para enviar'),
        f.text('selectPlaceholder', 'Texto de las listas sin elegir'),
      ]),
      ...inGroup('Paso 1: alumno y tutor', [
        f.text('studentTitle', 'Alumno: título'), f.text('studentSubtitle', 'Alumno: subtítulo'),
        f.text('firstNameLabel', 'Nombre(s)'), f.text('lastNameLabel', 'Apellidos'), f.text('dobLabel', 'Fecha de nacimiento'),
        f.text('gradeLabel', 'Grado'), f.text('curpLabel', 'CURP'), f.text('nationalityLabel', 'Nacionalidad'),
        f.text('parentTitle', 'Tutor: título'), f.text('parentSubtitle', 'Tutor: subtítulo'),
        f.text('parentNameLabel', 'Nombre del tutor'), f.text('emailLabel', 'Correo'), f.text('phoneLabel', 'Teléfono'),
      ]),
      ...inGroup('Paso 2: datos adicionales', [
        f.text('moreTitle', 'Título'), f.text('moreSubtitle', 'Subtítulo'), f.text('occupationLabel', 'Ocupación del tutor'),
        f.text('parent2Title', 'Segundo tutor: título'), f.text('parent2NameLabel', 'Segundo tutor: nombre'),
        f.text('parent2EmailLabel', 'Segundo tutor: correo'), f.text('parent2PhoneLabel', 'Segundo tutor: teléfono'),
        f.text('emergencyTitle', 'Emergencia: título'), f.text('emergencyNameLabel', 'Emergencia: nombre'),
        f.text('emergencyPhoneLabel', 'Emergencia: teléfono'), f.text('emergencyRelLabel', 'Emergencia: parentesco'),
      ]),
      ...inGroup('Paso 3: salud y documentos', [
        f.text('healthTitle', 'Salud: título'), f.text('bloodLabel', 'Tipo de sangre'), f.text('allergiesLabel', 'Alergias'), f.text('medicalLabel', 'Notas médicas'),
        f.text('docsTitle', 'Documentos: título'), f.text('docsSubtitle', 'Documentos: subtítulo'),
        f.text('docBirthCert', 'Documento: acta de nacimiento'), f.text('docCurp', 'Documento: CURP'), f.text('docPhoto', 'Documento: fotografía'),
        f.text('docReportCard', 'Documento: boleta'), f.text('docProofAddr', 'Documento: comprobante de domicilio'),
        f.text('attachLabel', 'Botón «Adjuntar»'), f.text('removeLabel', 'Botón «Quitar»'),
      ]),
      ...inGroup('Consentimientos', [
        f.text('consentMedical', 'Casilla de datos de salud', { hint: 'Es lo que la familia autoriza: cambie el sentido solo con la aprobación de Dirección.' }),
        f.text('consentPhotos', 'Casilla de fotografías', { hint: 'Es lo que la familia autoriza: cambie el sentido solo con la aprobación de Dirección.' }),
        f.text('privacyAccept', 'Casilla del aviso de privacidad'),
      ]),
      ...inGroup('Mensajes', [
        f.text('errRequired', 'Campo obligatorio vacío'), f.text('errMissing', 'Aviso: faltan campos'),
        f.text('errStart', 'No se pudo iniciar'), f.text('errSave', 'No se pudieron guardar los datos'),
        f.text('errPrivacy', 'Falta aceptar el aviso'), f.text('errMedicalConsent', 'Falta el consentimiento de salud'),
        f.text('errUploads', 'Archivos que no subieron', { hint: '{documentos} = la lista de documentos.' }),
        f.text('errFileType', 'Tipo de archivo no válido', { hint: '{documento} = el documento.' }),
        f.text('errFileSize', 'Archivo muy grande', { hint: '{documento} = el documento.' }),
        f.text('errSubmit', 'No se pudo enviar'),
      ]),
      ...inGroup('Invitación', [
        f.text('booting', 'Mientras valida la invitación'),
        f.text('invitedTitle', 'Aviso de invitación: título'), f.textarea('invitedText', 'Aviso de invitación: texto'),
        f.text('inviteErrorTitle', 'Invitación no válida: título'), f.textarea('inviteErrorText', 'Invitación no válida: texto'),
        f.link('inviteErrorLink', 'Invitación no válida: botón'),
      ]),
      ...inGroup('Confirmación y pie', [
        f.text('successTitle', 'Confirmación: título'),
        f.textarea('successText', 'Confirmación: texto', { hint: '{nombre} = el nombre del alumno, en negritas.' }),
        f.link('successPrimary', 'Confirmación: botón principal'), f.link('successSecondary', 'Confirmación: botón secundario'),
        f.text('footerText', 'Pie: texto'), f.link('footerLink', 'Pie: enlace'),
      ]),
    ],
    defaults: {
      step1: 'Alumno y tutor', step2: 'Datos adicionales', step3: 'Salud y documentos', stepsLabel: 'Progreso de inscripción',
      nextLabel: 'Siguiente', backLabel: 'Atrás', submitLabel: 'Enviar inscripción', selectPlaceholder: 'Seleccionar…',
      studentTitle: 'Datos del alumno', studentSubtitle: 'Información del candidato a inscripción',
      firstNameLabel: 'Nombre(s)', lastNameLabel: 'Apellidos', dobLabel: 'Fecha de nacimiento', gradeLabel: 'Grado al que aplica',
      curpLabel: 'CURP (opcional)', nationalityLabel: 'Nacionalidad',
      parentTitle: 'Tutor principal', parentSubtitle: 'Padre, madre o tutor',
      parentNameLabel: 'Nombre completo del tutor', emailLabel: 'Correo electrónico', phoneLabel: 'Teléfono / WhatsApp',
      moreTitle: 'Datos adicionales del tutor', moreSubtitle: 'Opcional — puede completarlos ahora o después',
      occupationLabel: 'Ocupación del tutor',
      parent2Title: 'Segundo tutor (opcional)', parent2NameLabel: 'Nombre completo', parent2EmailLabel: 'Correo electrónico', parent2PhoneLabel: 'Teléfono',
      emergencyTitle: 'Contacto de emergencia (opcional)', emergencyNameLabel: 'Nombre', emergencyPhoneLabel: 'Teléfono', emergencyRelLabel: 'Parentesco',
      healthTitle: 'Información de salud (opcional)', bloodLabel: 'Tipo de sangre', allergiesLabel: 'Alergias', medicalLabel: 'Notas médicas',
      docsTitle: 'Documentos', docsSubtitle: 'Adjunte los que tenga disponibles (PDF o imagen). Puede completarlos después.',
      docBirthCert: 'Acta de Nacimiento', docCurp: 'CURP', docPhoto: 'Fotografía', docReportCard: 'Boleta Anterior', docProofAddr: 'Comprobante de Domicilio',
      attachLabel: 'Adjuntar', removeLabel: 'Quitar',
      consentMedical: 'Autorizo el tratamiento de los datos de salud proporcionados.',
      consentPhotos: 'Autorizo el uso de fotografías y material audiovisual con fines institucionales.',
      privacyAccept: 'He leído y acepto el Aviso de Privacidad.',
      errRequired: 'Este campo es obligatorio.', errMissing: 'Complete los campos obligatorios.',
      errStart: 'No se pudo iniciar la inscripción. Verifique los datos.', errSave: 'No se pudieron guardar los datos. Intente de nuevo.',
      errPrivacy: 'Debe aceptar el Aviso de Privacidad.', errMedicalConsent: 'Marque el consentimiento de datos de salud para enviar información médica.',
      errUploads: 'No se pudieron subir: {documentos}. Revise tamaño/formato e intente de nuevo.',
      errFileType: '{documento}: use PDF, JPG o PNG.', errFileSize: '{documento}: el archivo supera 10 MB.',
      errSubmit: 'No se pudo enviar la inscripción. Intente de nuevo.',
      booting: 'Validando su invitación…',
      invitedTitle: 'Invitación de inscripción',
      invitedText: '— precargamos sus datos del pre-registro. Revíselos, complete la información y adjunte los documentos.',
      inviteErrorTitle: 'Invitación no válida',
      inviteErrorText: 'El enlace de inscripción no es válido o ha expirado. Solicite uno nuevo al equipo de admisiones, o inicie su pre-registro.',
      inviteErrorLink: { label: 'Ir al pre-registro', href: '/pre-registro' },
      successTitle: '¡Inscripción enviada!',
      successText: 'Hemos recibido la documentación de inscripción de {nombre}. El equipo de admisiones la revisará y le informará en un plazo de 3 a 5 días hábiles.',
      successPrimary: { label: 'Ir al portal', href: '/portal' }, successSecondary: { label: 'Volver al inicio', href: '/' },
      footerText: '¿Aún no ha hecho su pre-registro?', footerLink: { label: 'Inicie aquí', href: '/pre-registro' },
    },
  }),
];

export const templates = [{
  slug: 'inscripcion', path: '/inscripcion', title: 'Inscripción', group: 'inscripcion',
  // RouteSeo (siteMeta ROUTE_META '/inscripcion') keeps serving these until the school writes its own SEO.
  seo: {},
  sections: ['inscripcion.hero', 'inscripcion.wizard'],
}];

export default defineModule(sections, templates);
