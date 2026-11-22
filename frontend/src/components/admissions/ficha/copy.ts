/**
 * Every word of the ficha that is not a field of the schema: step titles and
 * intros, the titled blocks inside each step («Nombre», «Nacimiento»…) and
 * their one-line hints, buttons, save states, the private-ficha panel (no link), the start
 * screen (only when Ajustes allows a public start), «continuar después», the
 * review and signature, the confirmation. They are the props of the locked
 * «Ficha de inscripción · Formulario» section (cms/sections/preregistro.tsx),
 * edited in Contenido; these are today's defaults. Field labels, help and
 * options come from the schema endpoint (one source with the server).
 *
 * `{name}` placeholders are filled by the form ({n}, {total}, {correo},
 * {nombre}, {grado}…); `{{ciclo}}` and the other site tokens by the CMS.
 */
import type { CmsLink } from '@/cms/runtime';

export const FICHA_TEXT = {
  // Pasos y botones
  stepsLabel: 'Pasos de la ficha',
  stepOf: 'Paso {n} de {total}',
  stepsToggle: 'Ver los pasos',
  stepsHide: 'Ocultar',
  stateDone: 'Completo',
  stateMissing: 'Faltan datos',
  statePending: 'Pendiente',
  stateCurrent: 'Paso actual',
  nextLabel: 'Guardar y continuar',
  backLabel: 'Anterior',
  reviewReturn: 'Guardar y volver a la revisión',
  laterLabel: 'Guardar y continuar después',
  optionalMark: 'opcional',
  selectPlaceholder: 'Elija una opción',
  // Guardado y errores
  saving: 'Guardando…',
  saved: 'Guardado',
  saveError: 'No se pudo guardar. Revise su conexión e intente de nuevo.',
  errorSummary: 'Datos por revisar: {n}',
  errRequired: 'Este dato es obligatorio.',
  loadError: 'No pudimos abrir la ficha. Revise su conexión e intente de nuevo.',
  retryLabel: 'Intentar de nuevo',
  expiredTitle: 'Su sesión terminó',
  sessionExpired: 'Su sesión venció por seguridad. Pida un enlace nuevo; lo que guardó sigue ahí.',
  // Antes de empezar
  startTitle: 'Antes de empezar',
  startIntro: 'Guardamos su ficha y le enviamos a su correo un enlace para continuarla.',
  checklistTitle: 'Tenga a la mano',
  whoTitle: 'Sus datos',
  childTitle: 'Datos del alumno',
  moreTitle: 'Para conocerle mejor',
  startSubmit: 'Comenzar la ficha',
  startError: 'No pudimos guardar sus datos. Revise su conexión e intente de nuevo.',
  // Continuar una ficha
  resumeToggle: '¿Ya recibió su enlace y venció? Reciba uno nuevo',
  resumeText: 'Escriba el correo donde recibió la ficha y le enviamos un enlace nuevo.',
  resumeEmail: 'Correo electrónico',
  resumeSubmit: 'Enviar enlace',
  resumeDone: 'Si ese correo tiene una ficha, le enviamos un enlace. Revise también el correo no deseado.',
  resumeError: 'No pudimos enviar la solicitud. Intente de nuevo en un momento.',
  // Ficha personal: /pre-registro without a link (the school sends it after admission)
  privateTitle: 'La ficha de inscripción es personal',
  privateText: 'Ábrala con el enlace que el colegio le envió por correo o WhatsApp.',
  privateStepsTitle: 'Así es el proceso de admisión',
  privateWhatsapp: 'Escribir por WhatsApp',
  privateWaMessage: 'Hola, me gustaría recibir informes de admisión del Colegio Interlaken.',
  privateCall: '¿Prefiere llamar?',
  // Enlace personal
  booting: 'Abriendo su ficha…',
  invitedTitle: 'Su ficha ya tiene los primeros datos.',
  invitedText: 'Revíselos y complete los pasos que faltan. Cada paso se guarda al continuar.',
  inviteErrorTitle: 'El enlace ya no es válido',
  inviteErrorText: 'Escriba su correo y le enviamos uno nuevo. Lo que guardó sigue ahí.',
  sentTitle: 'Esta ficha ya fue enviada',
  sentText: 'Si necesita corregir algún dato, responda al correo de confirmación o llame a admisiones.',
  // Paso: alumno
  alumnoTitle: 'Información del alumno',
  alumnoIntro: 'Tenga a la mano el acta de nacimiento y la CURP del alumno.',
  alumnoNameTitle: 'Nombre',
  alumnoNameHint: 'Como aparecen en el acta de nacimiento.',
  alumnoBirthTitle: 'Nacimiento',
  alumnoBirthHint: 'Con la CURP llenamos la fecha, el sexo y el estado.',
  alumnoSchoolTitle: 'Escuela',
  alumnoSchoolHint: 'El grado al que se inscribe y la escuela de la que viene.',
  curpHint: '¿No tiene la CURP a la mano?',
  curpFilled: 'Llenamos la fecha de nacimiento, el sexo y el estado con la CURP. Revíselos.',
  levelLabel: 'Nivel',
  ageHint: 'Para {grado} el alumno debe tener {edad} años cumplidos al 31 de diciembre de {anio} (tendrá {tiene}). Revise el grado y la fecha de nacimiento, o llame a admisiones.',
  countryMexico: 'México',
  countryOther: 'Otro país',
  countryOtherLabel: 'Escriba el país',
  stateOtherLabel: 'Estado, provincia o región',
  // Paso: domicilio
  domicilioTitle: 'Domicilio',
  domicilioIntro: 'El domicilio donde vive el alumno.',
  domicilioAddressTitle: 'Dirección',
  domicilioAddressHint: 'Como aparece en un recibo de luz, agua o teléfono.',
  domicilioPhoneTitle: 'Teléfono',
  domicilioPhoneHint: 'Si no tiene teléfono fijo, déjelo en blanco.',
  // Paso: salud
  saludTitle: 'Información de salud',
  saludIntro: 'Datos sensibles: se guardan cifrados y solo los consulta la dirección del colegio.',
  saludGeneralTitle: 'Datos generales',
  saludGeneralHint: 'La estatura y el peso pueden ser aproximados.',
  saludCareTitle: 'Alergias y padecimientos',
  saludCareHint: 'Lo que debemos saber para cuidar al alumno.',
  saludConsentTitle: 'Autorización',
  saludConsentHint: 'Necesaria para guardar los datos de salud.',
  // Pasos: padre y madre
  padreTitle: 'Información del padre',
  madreTitle: 'Información de la madre',
  tutorIntro: 'Escriba los datos como aparecen en su identificación oficial.',
  tutorPersonalTitle: 'Datos personales',
  tutorPersonalHint: 'Nombre, apellidos y estado civil.',
  tutorBirthTitle: 'Nacimiento y CURP',
  tutorBirthHint: 'Con la CURP llenamos la fecha, el sexo y el estado.',
  tutorWorkTitle: 'Estudios y ocupación',
  tutorWorkHint: 'El último grado de estudios y a qué se dedica.',
  tutorContactTitle: 'Contacto',
  tutorContactHint: 'Para comunicarnos sobre el alumno.',
  prefillFromContact: 'Usamos los datos de quien llena la ficha. Revíselos y complete los que faltan.',
  naConfirmTitle: 'Quitar los datos de este bloque',
  naConfirmText: 'Al marcar «No aplica» se borran los datos que escribió en este bloque.',
  naConfirm: 'Sí, no aplica',
  naCollapsed: 'Marcó que este bloque no aplica. Puede continuar al siguiente paso.',
  // Paso: emergencia
  emergenciaTitle: 'Contacto de emergencia',
  emergenciaIntro: 'Alguien distinto de los padres a quien llamar si no les localizamos.',
  emergenciaBlockTitle: 'Datos del contacto',
  emergenciaBlockHint: 'Escriba al menos un teléfono.',
  // Quién llena la ficha
  contactoTitle: 'Quién llena la ficha',
  contactoIntro: 'A este correo y a este celular le escribiremos sobre la admisión.',
  // Revisión y firma
  reviewTitle: 'Revisión y firma',
  reviewIntro: 'Revise sus respuestas. Puede corregir cualquier sección antes de firmar.',
  reviewEdit: 'Editar',
  reviewEmpty: 'Sin dato',
  reviewYes: 'Sí',
  reviewNo: 'No',
  reviewNotApplicable: 'No aplica',
  reviewMissing: 'Faltan datos en esta sección',
  privacyTitle: 'Aviso de privacidad',
  privacyText: 'El Colegio Interlaken trata estos datos para el proceso de admisión y, si el alumno se inscribe, para su expediente escolar, conforme a su Aviso de Privacidad. Los datos de salud se guardan cifrados.',
  signTitle: 'Firma',
  submitLabel: 'Enviar la ficha de inscripción',
  submitError: 'No pudimos enviar la ficha. Intente de nuevo.',
  incompleteTitle: 'Faltan datos en algunas secciones',
  incompleteText: 'Corrija lo marcado y vuelva a enviar la ficha.',
  fixLabel: 'Corregir',
  // Guardar y continuar después
  laterTitle: 'Guardamos su avance',
  laterText: 'Enviamos a {correo} un enlace para continuar. Si no llega, revise el correo no deseado.',
  laterBack: 'Seguir llenando ahora',
  laterError: 'Guardamos su avance, pero no pudimos enviar el correo. Intente de nuevo en un minuto.',
  // Confirmación
  doneTitle: 'Recibimos su ficha de inscripción',
  doneText: 'La ficha de {nombre} ya está con Admisiones. Le enviamos la confirmación por correo.',
  doneStepsTitle: 'Qué sigue',
} as const;

export const FICHA_LINKS = {
  curpLink: { label: 'Consultar la CURP en gob.mx', href: 'https://www.gob.mx/curp/' },
  privacyLink: { label: 'Leer el Aviso de Privacidad', href: '/aviso-de-privacidad' },
  doneVisit: { label: 'Ver los documentos requeridos', href: '/admisiones/documentacion' },
  privateVisit: { label: 'Agendar visita', href: '/agendar-visita' },
  donePrimary: { label: 'Ver el proceso de admisión', href: '/admisiones' },
  doneSecondary: { label: 'Volver al inicio', href: '/' },
} satisfies Record<string, CmsLink>;

/** Lists edited as items (each `{text}`). */
export const FICHA_LISTS = {
  checklist: [
    'La CURP y el acta de nacimiento del alumno',
    'Los datos de la madre y del padre, o de quien tenga la tutela',
    'Un contacto de emergencia distinto de los padres',
  ],
  doneSteps: [
    'Revisamos la ficha en un plazo de 3 a 5 días hábiles.',
    'Le pedimos los documentos del alumno con un enlace personal.',
    'Con los documentos y el pago de inscripción, su lugar queda asegurado.',
  ],
  privateSteps: [
    'Agende una visita o solicite informes.',
    'Su hijo/a presenta el examen de valoración.',
    'Si su hijo/a es admitido, le enviamos su ficha de inscripción.',
  ],
} as const;

export type TextKey = keyof typeof FICHA_TEXT;
export type LinkKey = keyof typeof FICHA_LINKS;
export type ListKey = keyof typeof FICHA_LISTS;

/** What the wizard reads its words through (the CMS section, or the defaults in tests). */
export interface FichaCopy {
  t: (key: TextKey) => string;
  link: (key: LinkKey) => CmsLink;
  list: (key: ListKey) => string[];
}

/** The defaults as a FichaCopy (tests, and anything rendered outside the CMS page). */
export const defaultCopy: FichaCopy = {
  t: (k) => FICHA_TEXT[k],
  link: (k) => FICHA_LINKS[k],
  list: (k) => [...FICHA_LISTS[k]],
};

/** Long texts get a text area in the editor. */
export const LONG_TEXTS: ReadonlySet<TextKey> = new Set<TextKey>([
  'startIntro', 'resumeText', 'resumeDone', 'privateText', 'privateWaMessage', 'invitedText', 'inviteErrorText',
  'sentText', 'alumnoIntro', 'curpHint', 'ageHint', 'saludIntro', 'tutorIntro', 'prefillFromContact', 'naConfirmText',
  'naCollapsed', 'emergenciaIntro', 'reviewIntro', 'privacyText', 'incompleteText', 'laterText', 'laterError',
  'doneText', 'sessionExpired', 'loadError', 'saveError', 'startError', 'resumeError', 'submitError', 'domicilioIntro', 'contactoIntro',
]);

/** Texts the school may leave blank on purpose (an intro, a hint); any other blank one keeps its default. */
export const BLANKABLE: ReadonlySet<TextKey> = new Set<TextKey>([
  'startIntro', 'checklistTitle', 'alumnoIntro', 'domicilioIntro', 'saludIntro', 'tutorIntro', 'emergenciaIntro',
  'contactoIntro', 'reviewIntro', 'curpHint', 'invitedText', 'prefillFromContact', 'privacyText', 'incompleteText',
  'alumnoNameHint', 'alumnoBirthHint', 'alumnoSchoolHint', 'domicilioAddressHint', 'domicilioPhoneHint',
  'saludGeneralHint', 'saludCareHint', 'saludConsentHint', 'tutorPersonalHint', 'tutorBirthHint', 'tutorWorkHint',
  'tutorContactHint', 'emergenciaBlockHint',
]);

/**
 * Defaults the design used to ship (2026-11-21, «Paso 1 de 7: Información del
 * alumno»). A CMS page that stored one of them before they changed shows the
 * current default instead; a text the school wrote itself always wins.
 */
export const RETIRED_DEFAULTS: Partial<Record<TextKey, readonly string[]>> = {
  backLabel: ['Atrás'],
  alumnoTitle: ['Datos del alumno'],
  alumnoIntro: ['Escríbalos como aparecen en el acta de nacimiento.'],
  curpHint: ['Si escribe primero la CURP, llenamos la fecha de nacimiento, el sexo y el estado de nacimiento.'],
  saludTitle: ['Salud'],
  padreTitle: ['Datos del padre'],
  madreTitle: ['Datos de la madre'],
  // 2026-11-21 (UX refinement): one error line and messages of 15 words or fewer.
  errorSummary: ['Revise estos datos para continuar:'],
  sessionExpired: ['Por seguridad, su sesión venció. Pida un enlace nuevo con su correo para continuar; lo que ya guardó sigue ahí.'],
  startIntro: ['Con estos datos guardamos su ficha y le enviamos a su correo un enlace para continuarla. Toda la ficha toma unos 15 minutos y puede guardarla y continuar después.'],
  resumeText: ['Escriba el correo al que le enviamos la ficha de inscripción y le mandamos un enlace nuevo para continuarla.'],
  resumeDone: ['Si hay una ficha en proceso con ese correo, le enviamos un enlace para continuarla. Revise su bandeja de entrada y la carpeta de correo no deseado.'],
  privateText: ['El colegio envía la ficha de inscripción por correo o WhatsApp a cada familia cuando su hijo/a es admitido.'],
  inviteErrorText: ['El enlace ya se usó o venció. Escriba su correo y le enviamos uno nuevo; lo que ya guardó sigue ahí.'],
  laterText: ['Le enviamos a {correo} un enlace para continuar cuando guste. Si no lo ve en unos minutos, revise la carpeta de correo no deseado.'],
  doneText: ['Gracias. La ficha de {nombre} ya está con el equipo de Admisiones. Le enviamos la confirmación a su correo.'],
};

/**
 * Editor groups and labels, in the order the family meets them. Keys not
 * listed here are not editable (there are none: a test keeps them in step).
 */
export const FICHA_GROUPS: { group: string; texts: [TextKey, string][]; links?: [LinkKey, string][]; lists?: [ListKey, string][] }[] = [
  {
    group: 'Pasos y botones',
    texts: [
      ['stepsLabel', 'Nombre de la lista de pasos (lectores de pantalla)'], ['stepOf', 'Paso actual de cuántos'],
      ['stepsToggle', 'Botón para ver los pasos'], ['stepsHide', 'Botón para ocultar los pasos'],
      ['stateDone', 'Estado: completo'], ['stateMissing', 'Estado: faltan datos'], ['statePending', 'Estado: pendiente'],
      ['stateCurrent', 'Estado: paso actual'], ['nextLabel', 'Botón para continuar'], ['backLabel', 'Botón para volver'],
      ['reviewReturn', 'Botón para volver a la revisión'], ['laterLabel', 'Botón para continuar después'],
      ['optionalMark', 'Marca de dato opcional'], ['selectPlaceholder', 'Texto de las listas sin elegir'],
    ],
  },
  {
    group: 'Guardado y errores',
    texts: [
      ['saving', 'Mientras guarda'], ['saved', 'Al guardar'], ['saveError', 'Si no se pudo guardar'],
      ['errorSummary', 'Aviso de datos por revisar ({n} = cuántos)'], ['errRequired', 'Dato obligatorio vacío'],
      ['loadError', 'Si no se pudo abrir la ficha'], ['retryLabel', 'Botón para intentar de nuevo'],
      ['expiredTitle', 'Sesión vencida: título'], ['sessionExpired', 'Sesión vencida: texto'],
    ],
  },
  {
    group: 'Antes de empezar',
    texts: [
      ['startTitle', 'Título del inicio'], ['startIntro', 'Explicación del inicio'], ['checklistTitle', 'Encabezado de la lista «Tenga a la mano»'],
      ['whoTitle', 'Encabezado de los datos de quien llena'], ['childTitle', 'Encabezado de los datos del alumno'],
      ['moreTitle', 'Encabezado de las preguntas finales'], ['startSubmit', 'Botón para comenzar'], ['startError', 'Si no se pudo comenzar'],
    ],
    lists: [['checklist', 'Lista «Tenga a la mano»']],
  },
  {
    group: 'Continuar una ficha',
    texts: [
      ['resumeToggle', 'Enlace para pedir un enlace nuevo'], ['resumeText', 'Explicación'], ['resumeEmail', 'Etiqueta del correo'],
      ['resumeSubmit', 'Botón para enviar'], ['resumeDone', 'Respuesta al enviar'], ['resumeError', 'Si no se pudo enviar'],
    ],
  },
  {
    group: 'Ficha personal (sin enlace)',
    texts: [
      ['privateTitle', 'Título del aviso'], ['privateText', 'Texto del aviso'], ['privateStepsTitle', 'Encabezado de los pasos'],
      ['privateWhatsapp', 'Botón de WhatsApp'], ['privateWaMessage', 'Mensaje inicial de WhatsApp'], ['privateCall', 'Texto antes del teléfono'],
    ],
    lists: [['privateSteps', 'Pasos del proceso']],
    links: [['privateVisit', 'Botón para agendar la visita']],
  },
  {
    group: 'Enlace personal',
    texts: [
      ['booting', 'Mientras abre el enlace'], ['invitedTitle', 'Aviso al abrir el enlace: inicio'], ['invitedText', 'Aviso al abrir el enlace: resto'],
      ['inviteErrorTitle', 'Enlace no válido: título'], ['inviteErrorText', 'Enlace no válido: texto'],
      ['sentTitle', 'Ficha ya enviada: título'], ['sentText', 'Ficha ya enviada: texto'],
    ],
  },
  {
    group: 'Paso: alumno',
    texts: [
      ['alumnoTitle', 'Título del paso del alumno'], ['alumnoIntro', 'Explicación del paso del alumno'],
      ['alumnoNameTitle', 'Bloque del nombre: título'], ['alumnoNameHint', 'Bloque del nombre: ayuda'],
      ['alumnoBirthTitle', 'Bloque del nacimiento: título'], ['alumnoBirthHint', 'Bloque del nacimiento: ayuda'],
      ['alumnoSchoolTitle', 'Bloque de la escuela: título'], ['alumnoSchoolHint', 'Bloque de la escuela: ayuda'],
      ['curpHint', 'Ayuda de la CURP'],
      ['curpFilled', 'Aviso al llenar con la CURP'], ['levelLabel', 'Etiqueta del nivel'], ['ageHint', 'Aviso de edad'],
      ['countryMexico', 'Opción México'], ['countryOther', 'Opción otro país'], ['countryOtherLabel', 'Etiqueta del país'],
      ['stateOtherLabel', 'Etiqueta del estado en el extranjero'],
    ],
    links: [['curpLink', 'Enlace para consultar la CURP']],
  },
  {
    group: 'Paso: domicilio',
    texts: [
      ['domicilioTitle', 'Título del paso del domicilio'], ['domicilioIntro', 'Explicación del paso del domicilio'],
      ['domicilioAddressTitle', 'Bloque de la dirección: título'], ['domicilioAddressHint', 'Bloque de la dirección: ayuda'],
      ['domicilioPhoneTitle', 'Bloque del teléfono: título'], ['domicilioPhoneHint', 'Bloque del teléfono: ayuda'],
    ],
  },
  {
    group: 'Paso: salud',
    texts: [
      ['saludTitle', 'Título del paso de salud'], ['saludIntro', 'Explicación del paso de salud'],
      ['saludGeneralTitle', 'Bloque de datos generales: título'], ['saludGeneralHint', 'Bloque de datos generales: ayuda'],
      ['saludCareTitle', 'Bloque de alergias: título'], ['saludCareHint', 'Bloque de alergias: ayuda'],
      ['saludConsentTitle', 'Bloque de la autorización: título'], ['saludConsentHint', 'Bloque de la autorización: ayuda'],
    ],
  },
  {
    group: 'Pasos: padre y madre',
    texts: [
      ['padreTitle', 'Título del paso del padre'], ['madreTitle', 'Título del paso de la madre'], ['tutorIntro', 'Explicación de padre y madre'],
      ['tutorPersonalTitle', 'Bloque de datos personales: título'], ['tutorPersonalHint', 'Bloque de datos personales: ayuda'],
      ['tutorBirthTitle', 'Bloque de nacimiento y CURP: título'], ['tutorBirthHint', 'Bloque de nacimiento y CURP: ayuda'],
      ['tutorWorkTitle', 'Bloque de estudios y ocupación: título'], ['tutorWorkHint', 'Bloque de estudios y ocupación: ayuda'],
      ['tutorContactTitle', 'Bloque de contacto: título'], ['tutorContactHint', 'Bloque de contacto: ayuda'],
      ['prefillFromContact', 'Aviso de datos de quien llena'], ['naConfirmTitle', '«No aplica»: título de la confirmación'],
      ['naConfirmText', '«No aplica»: texto de la confirmación'], ['naConfirm', '«No aplica»: botón para confirmar'],
      ['naCollapsed', '«No aplica»: aviso del bloque cerrado'],
    ],
  },
  {
    group: 'Paso: emergencia',
    texts: [
      ['emergenciaTitle', 'Título del paso de emergencia'], ['emergenciaIntro', 'Explicación del paso de emergencia'],
      ['emergenciaBlockTitle', 'Bloque del contacto: título'], ['emergenciaBlockHint', 'Bloque del contacto: ayuda'],
    ],
  },
  { group: 'Quién llena la ficha', texts: [['contactoTitle', 'Título de los datos de quien llena'], ['contactoIntro', 'Explicación de los datos de quien llena']] },
  {
    group: 'Revisión y firma',
    texts: [
      ['reviewTitle', 'Título de la revisión'], ['reviewIntro', 'Explicación de la revisión'], ['reviewEdit', 'Botón para editar una sección'],
      ['reviewEmpty', 'Dato vacío'], ['reviewYes', 'Respuesta sí'], ['reviewNo', 'Respuesta no'], ['reviewNotApplicable', 'Bloque que no aplica'],
      ['reviewMissing', 'Sección con datos faltantes'], ['privacyTitle', 'Encabezado del aviso de privacidad'], ['privacyText', 'Texto del aviso de privacidad'],
      ['signTitle', 'Encabezado de la firma'], ['submitLabel', 'Botón para enviar la ficha'], ['submitError', 'Si no se pudo enviar'],
      ['incompleteTitle', 'Faltan datos: título'], ['incompleteText', 'Faltan datos: texto'], ['fixLabel', 'Botón para corregir'],
    ],
    links: [['privacyLink', 'Enlace al Aviso de Privacidad']],
  },
  {
    group: 'Guardar y continuar después',
    texts: [['laterTitle', 'Título'], ['laterText', 'Texto'], ['laterBack', 'Botón para seguir ahora'], ['laterError', 'Si no se pudo enviar el correo']],
  },
  {
    group: 'Confirmación',
    texts: [['doneTitle', 'Título de la confirmación'], ['doneText', 'Texto de la confirmación'], ['doneStepsTitle', 'Encabezado de los siguientes pasos']],
    lists: [['doneSteps', 'Siguientes pasos']],
    links: [['doneVisit', 'Botón destacado'], ['donePrimary', 'Botón principal'], ['doneSecondary', 'Botón secundario']],
  },
];

/** `{name}` placeholders → values (unknown names stay as written). */
export function fillText(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** «Paso 2 de 7» (the copy's `stepOf`). */
export const stepNumber = (copy: FichaCopy, n: number, total: number) => fillText(copy.t('stepOf'), { n, total });

/** «Paso 2 de 7: Domicilio», how a numbered step is read aloud and named in lists. */
export const numberedTitle = (number: string | undefined, title: string) => (number ? `${number}: ${title}` : title);
