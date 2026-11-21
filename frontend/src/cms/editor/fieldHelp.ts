/**
 * Plain-Spanish help under every field of the CMS editor (round «editor
 * fields», item 4). Lives here, in the console bundle, so the public pages do
 * not carry it. Order: a section-specific text (OVERRIDES), the spec's own
 * `hint`, then help by label, then by kind. fieldHelp.test.ts fails when a
 * text field of any section is left without specific help, or when an
 * override points at a field that no longer exists.
 */
import type { FieldKind, FieldSpec } from '../blocks/registry';
import { COVERAGE_HELP } from './fieldHelpCoverage';

/** Help by the field's label (labels repeat across sections with the same meaning). */
const BY_LABEL: Record<string, string> = {
  'Etiqueta superior': 'Palabra o frase corta que va arriba del título, en mayúsculas.',
  'Título': 'El encabezado de esta parte de la página.',
  'Título de sección': 'Encabezado que va arriba de las tarjetas.',
  'Subtítulo': 'Frase que acompaña al título, en letra más pequeña.',
  'Texto': 'Párrafo que acompaña al título.',
  'Descripción': 'Una o dos frases que explican la tarjeta.',
  'Nombre': 'Nombre que aparece como título de la tarjeta.',
  'Etiqueta': 'Palabra corta que describe el dato.',
  'Valor': 'La cifra o el dato grande, por ejemplo «45» o «+600».',
  'Texto del botón': 'Lo que dice el botón, por ejemplo «Ver más».',
  'Texto del enlace': 'Lo que dice el enlace. Vacío: no se muestra.',
  'Texto del botón de envío': 'Lo que dice el botón para enviar el formulario.',
  'Pie de foto': 'Frase corta que acompaña a la foto. Opcional.',
  'Pregunta': 'La pregunta tal como la haría una familia.',
  'Respuesta': 'Respuesta breve y clara.',
  'Documento': 'Nombre del documento que se pide.',
  'Año': 'Año del momento, por ejemplo 1981.',
  'Nivel': 'Nombre del nivel: Preescolar, Primaria o Secundaria.',
  'Grados': 'Grados del nivel, por ejemplo «1.° a 6.°».',
  'Edades': 'Edades de los alumnos, por ejemplo «6 a 12 años».',
  'Concepto': 'Nombre del pago, por ejemplo «Inscripción».',
  'Explicación': 'Una frase que explica ese pago.',
  'Detalle': 'Información del grupo: edades, horario o cupo.',
  'Paso': 'Lo que hace la familia en este paso.',
  'Número': 'Número del paso, por ejemplo «01». Vacío: se numera solo.',
  'Aviso': 'Un punto importante que deben saber antes de pedir la factura.',
  'Extensión': 'Extensión telefónica del nivel. Opcional.',
  'Correo': 'Correo del nivel. Opcional.',
  'Mensaje inicial de WhatsApp': 'Texto que aparece ya escrito cuando la familia abre WhatsApp.',
  'Título del formulario': 'Encabezado que va arriba del formulario.',
  'Mensaje al enviar': 'Lo que ve la familia cuando su mensaje se envió bien.',
  'Mensaje si falla el envío': 'Lo que ve la familia si el envío no se pudo completar.',
  'Descripción de la foto (accesibilidad)': 'Qué se ve en la foto, para quien no puede verla y para Google.',
  'Descripción de la foto grande': 'Qué se ve en la foto grande, para quien no puede verla.',
  'Descripción de la foto superior': 'Qué se ve en la foto de arriba, para quien no puede verla.',
  'Descripción de la foto inferior': 'Qué se ve en la foto de abajo, para quien no puede verla.',
  'Insignia: cifra': 'Número grande de la insignia sobre las fotos. Vacío: sin insignia.',
  'Insignia: texto': 'Texto pequeño bajo la cifra de la insignia.',
  'Visibilidad de la foto (0 a 1)': 'Qué tanto se ve la foto detrás del texto: 0 no se ve, 1 se ve completa. El sitio usa entre 0.25 y 0.4.',
  'Cuántos testimonios mostrar': 'Se muestran los testimonios publicados en Contenido, Testimonios, hasta este número.',
  'Color de la etiqueta': 'Color de la etiqueta pequeña que va sobre el título.',
  'Fondo': 'Color de fondo de esta sección.',
  'Columnas en computadora': 'Cuántas tarjetas caben por fila en una pantalla grande. En el celular van una debajo de otra.',
  'Botón «Cómo llegar»': 'Lo que dice el botón que abre la dirección en Google Maps.',
  'Botón de WhatsApp': 'Lo que dice el botón de WhatsApp. Vacío: sin botón.',
  'Texto del botón de WhatsApp': 'Lo que dice el botón de WhatsApp.',
  'Enlace al trámite oficial': 'Página oficial donde se tramita el documento (por ejemplo, la del CURP). Opcional.',
};

/** Labels shaped «Parte: dato» (Costos, Agendar visita, Pre-registro…): help by the part after the colon. */
const BY_SUFFIX: [RegExp, string][] = [
  [/: etiqueta$/i, 'Palabra corta que va arriba del título de esa tarjeta.'],
  [/: título$/i, 'El encabezado de esa parte.'],
  [/: subtítulo$/i, 'Frase bajo el título de esa parte.'],
  [/: texto$/i, 'El párrafo de esa parte.'],
  [/: texto en negritas$/i, 'La parte del texto que se destaca en negritas.'],
  [/: texto antes del enlace$/i, 'Frase que va justo antes del enlace.'],
  [/: nota al pie$/i, 'Nota pequeña al final de la lista.'],
  [/: resumen$/i, 'Frase corta bajo el título de la lista.'],
];

/** Last resort by kind (never a text field: those must have specific help). */
const BY_KIND: Partial<Record<FieldKind, string>> = {
  image: 'Una foto de la biblioteca, o súbala aquí: también puede arrastrarla a este recuadro.',
  images: 'Agregue varias fotos a la vez. Las flechas cambian el orden.',
  link: 'Escriba el texto y elija a dónde lleva. Sin destino, el botón no se muestra.',
  href: 'La página del sitio a la que lleva, o un sitio externo, correo, teléfono o WhatsApp.',
  icon: 'El dibujo pequeño que acompaña al texto.',
  color: 'Color de acento de esta parte: líneas, íconos y fondos suaves.',
  items: 'Use «Agregar» para sumar uno; las flechas cambian el orden y «Duplicar» copia uno parecido.',
  toggle: 'Marque la casilla para mostrarlo en la página; desmárquela para ocultarlo.',
  select: 'Elija una opción de la lista.',
  richtext: 'Escriba como en un procesador de textos: seleccione el texto y elija negritas, lista, subtítulo o enlace.',
  form: 'Elija el formulario que se muestra en esta parte.',
  table: 'Una fila por concepto; la estrella destaca una fila (por ejemplo, la opción recomendada).',
};

/** Section-specific help: `type` → field path (`key`, or `list[].key` inside a list). */
export const OVERRIDES: Record<string, Record<string, string>> = {
  hero: {
    title: 'El título grande de la portada.',
    subtitle: 'Frase bajo el título.',
  },
  rich_text: {},
  table: {
    intro: 'Párrafo que va antes de la tabla. Opcional.',
    subtitle: 'Frase bajo el título de la tarjeta. Opcional.',
  },
  image: { caption: 'Frase corta bajo la imagen. Opcional.' },
  feature_grid: { 'items[].title': 'El título de la tarjeta.', 'items[].text': 'Una o dos frases que explican la tarjeta.' },
  stats: { 'items[].label': 'Qué cuenta la cifra, por ejemplo «años de experiencia».' },
  cta_band: { title: 'La invitación principal, por ejemplo «Agende su visita».', text: 'Una frase que anima a dar el paso.' },
  video: { url: 'Pegue el enlace del video de YouTube o Vimeo, el que aparece en la barra del navegador.' },
  timeline: { 'items[].title': 'Qué pasó ese año.', 'items[].text': 'Una o dos frases sobre ese momento.' },
  'page.hero': {
    title: 'El título grande de la portada. Un salto de renglón aquí también es un salto en el título.',
    focus: 'Qué parte de la foto queda a la vista si se recorta. Vacío: centrada. «center 30%» la sube un poco; «center 70%» la baja.',
  },
  'notfound.message': {
    code: 'El número grande de la página, normalmente «404».',
    title: 'Lo primero que lee quien llega a una página que ya no existe.',
    text: 'Explique qué pasó y qué puede hacer la persona.',
  },
  'documentacion.list': {
    title: 'Encabezado de la lista de documentos.',
    summary: 'Escriba {total} donde va el número de documentos del nivel elegido, {nivel} donde va el nivel y {online} donde va cuántos se tramitan en línea: se llenan solos.',
    tabsLabel: 'No se ve en pantalla: lo escucha quien usa un lector de pantalla al llegar a las pestañas de nivel.',
    physicalLabel: 'Lo que va antes de lo que se entrega en papel, por ejemplo «En físico:».',
    emptyText: 'Se ve si un nivel no tiene documentos publicados.',
    retryLabel: 'Lo que dice el botón para volver a cargar la lista.',
    ctaTitle: 'Encabezado del recuadro final.',
    ctaText: 'Texto del recuadro final.',
    cta: 'El botón del recuadro final.',
  },
  'admisiones.docs_cta': {
    docsTitle: 'Encabezado de la lista de documentos.',
    docsSummary: 'Escriba {total} donde va el número de documentos y {online} donde va cuántos se tramitan en línea: se cuentan solos.',
    docsOnlyLabel: 'Palabra antes de los niveles en los documentos que no piden todos, por ejemplo «Solo» (Solo Preescolar).',
    docsError: 'Se ve si la lista de documentos no carga; el enlace a la lista por nivel va después.',
    image: 'Foto del recuadro que invita a agendar una visita.',
    badge: 'Etiqueta pequeña sobre la foto, por ejemplo el ciclo escolar.',
    title: 'Encabezado del recuadro que invita a agendar una visita.',
    text: 'Texto del recuadro que invita a agendar una visita (la ficha de inscripción la envía el colegio después del examen).',
  },
  'modelo.pillars': {
    'items[].title': 'Nombre del pilar del modelo educativo.',
    'items[].text': 'Cómo se vive ese pilar en el colegio.',
    'links[].label': 'Lo que dice el enlace.',
  },
  'facturacion.notices': { title: 'Encabezado de los avisos.' },
  'facturacion.request': { title: 'Encabezado de la solicitud de factura.' },
  'facturacion.download': { title: 'Encabezado de la parte para descargar facturas.', text: 'Explique dónde y cómo descargar las facturas.' },
  'about.mission': { title: 'Encabezado de misión y visión.', 'items[].title': 'Por ejemplo «Misión» o «Visión».', 'items[].text': 'El texto completo de la misión, la visión o el bloque.' },
  'about.timeline': { 'items[].title': 'Qué pasó ese año.', 'items[].text': 'Una o dos frases sobre ese momento.' },
  'about.values': { 'items[].title': 'Nombre del valor, por ejemplo «Respeto».', 'items[].text': 'Cómo se vive ese valor en el colegio.' },
  'about.levels': { 'items[].name': 'Nombre del nivel.', 'items[].tone': 'Color de la tarjeta del nivel.' },
  'about.credentials': { 'items[].title': 'El respaldo o certificación.', 'items[].text': 'Una frase que lo explica.' },
  'about.cta': { title: 'La invitación final, por ejemplo «Conózcanos en persona».', text: 'Una frase que anima a dar el paso.' },
  'costos.hero': { title: 'El título grande de la portada.' },
  'costos.prices': {
    structureTitle: 'Encabezado de la explicación de cómo se paga.',
    newTag: 'Nombre de la pestaña con los precios para alumnos nuevos.',
    returningTag: 'Nombre de la pestaña con los precios de reinscripción.',
    policiesTitle: 'Encabezado de las políticas de pago (se editan en Ajustes, Costos).',
    noteText: 'La nota que aparece al final de las tablas.',
    noteStrong: 'La parte de la nota que se destaca en negritas.',
    noteLinkLead: 'Frase que va justo antes del enlace de la nota.',
    noteLink: 'El enlace al final de la nota.',
    ctaTitle: 'Encabezado del recuadro final.',
    ctaText: 'Texto del recuadro final.',
    colLevel: 'Encabezado de la columna con el nombre del nivel, en la tabla de inscripción.',
    colAdmin: 'Encabezado de la columna de gastos administrativos.',
    colNew: 'Encabezado de la columna con la cuota para alumnos nuevos.',
    colReturning: 'Encabezado de la columna con la cuota de reinscripción.',
    perMonth: 'Lo que va después de cada colegiatura, por ejemplo «/ mes».',
    perYear: 'Lo que va después de cada anualidad, por ejemplo «/ año».',
    daycareMonthly: 'Lo que va después de la tarifa mensual de estancia, por ejemplo «/ mes».',
    emptyTitle: 'Se muestra solo si todavía no hay precios publicados en «Costos y precios».',
    emptyText: 'Se muestra solo si todavía no hay precios publicados.',
  },
  'nivel.hero': { title: 'El nombre del nivel, en grande.', text: 'Uno o dos párrafos que presentan el nivel.', color: 'Color que identifica al nivel en la portada.' },
  'nivel.content': {
    'story[].title': 'El subtítulo de este apartado. Vacío en el primero: se lee como continuación de la portada.',
    'story[].text': 'Deje un renglón en blanco entre párrafos. Para negritas, seleccione el texto y use el botón B.',
    'story[].programs[].name': 'Nombre del programa, por ejemplo «Lee y Produce».',
    'story[].programs[].text': 'Qué hace el programa. Para negritas, seleccione el texto y use el botón B.',
    'story[].programs[].icon': 'El dibujo de la tarjeta.',
    photoAfter: 'Número del apartado después del cual va la foto. Por ejemplo, 2 la pone después del segundo.',
    groupsTitle: 'Encabezado de los grupos del nivel.',
    'groups[].name': 'Nombre del grupo, por ejemplo «Maternal».',
    'extras[].text': 'Un dato importante del nivel, con una palomita al inicio.',
    sepTitle: 'Encabezado del recuadro de incorporación a la SEP.',
    sepNote: 'Frase pequeña bajo el registro SEP.',
    sideTitle: 'Encabezado de los enlaces de la barra lateral.',
    'links[].label': 'Lo que dice el enlace de la barra lateral.',
  },
  'nivel.others': { title: 'Encabezado de las tarjetas de los otros niveles.', 'items[].name': 'Nombre del nivel en la tarjeta.' },
  'contacto.hero': { title: 'El título grande de la portada. Un salto de renglón aquí también es un salto en el título.' },
  'contacto.main': {
    infoTitle: 'Encabezado de los datos de contacto.',
    phoneLabel: 'Palabra que va antes del teléfono, por ejemplo «Teléfono».',
    hoursLabel: 'Palabra que va antes del horario, por ejemplo «Horario de oficina».',
    image: 'Foto de la entrada del colegio que acompaña los datos.',
    whatsappMessage: 'Texto que aparece ya escrito cuando la familia abre WhatsApp.',
  },
  'contacto.directory': { title: 'Encabezado del directorio de niveles.', 'items[].level': 'Nombre del nivel o del área.' },
  'contacto.map': {
    title: 'Encabezado de la sección del mapa.',
    mapsLabel: 'Lo que dice el enlace que abre la dirección en Google Maps.',
    embed: 'En Google Maps: Compartir, luego «Incorporar un mapa». Copie solo la dirección que empieza con https://www.google.com/maps/embed.',
    mapTitle: 'Qué muestra el mapa, para quien no puede verlo. Por ejemplo «Mapa del Colegio Interlaken».',
  },
  'aviso.hero': {
    dateLabel: 'Texto antes de la fecha del aviso, por ejemplo «Última actualización».',
    versionLabel: 'Texto antes del número de versión del aviso.',
  },
  'aviso.notice': {
    'cards[].label': 'Tema de la tarjeta, por ejemplo «Responsable».',
    note: 'Frase que aclara que las tarjetas son un resumen del aviso oficial.',
    integralLabel: 'Lo que dice el botón que muestra el aviso completo.',
    errorTitle: 'Se muestra solo si el aviso oficial no se puede cargar.',
  },
  'pagos.platforms': { 'items[].name': 'Nombre del acceso de pago.', 'items[].cta': 'Lo que dice el botón, por ejemplo «Pagar en línea».', note: 'Para poner un enlace, seleccione el texto y use el botón Enlace.' },
  'plataformas.platforms': { 'items[].name': 'Nombre de la plataforma.', 'items[].cta': 'Lo que dice el botón, por ejemplo «Abrir Classroom».', note: 'Para poner un enlace, seleccione el texto y use el botón Enlace.' },
  'visita.steps': { 'items[].text': 'Lo que hace la familia en este paso.' },
  'visita.booking': {
    pickTitle: 'Encabezado del calendario para elegir día y hora.',
    pickHint: 'Frase que se ve mientras la familia todavía no elige horario.',
    confirmedTitle: 'Encabezado que ve la familia al confirmar la visita.',
    confirmedText: 'Lo que ve la familia al confirmar: qué sigue y qué debe llevar.',
    againLabel: 'Lo que dice el botón para agendar otra visita.',
    whatsappTitle: 'Encabezado del recuadro de WhatsApp, junto al calendario.',
    whatsappText: 'Frase del recuadro de WhatsApp.',
    contactLabel: 'Lo que dice el botón de contacto si el colegio no tiene WhatsApp en Ajustes.',
  },
  'preregistro.trust': {
    first: 'Primer dato de confianza junto al formulario, por ejemplo «Respuesta en 24 horas».',
    second: 'Segundo dato de confianza junto al formulario.',
  },
  'home.hero': {
    showLogo: 'Muestra el logo del colegio sobre la foto o el video de portada.',
    title: 'El título grande de la portada (primera línea).',
    titleAccent: 'Segunda línea del título, en color degradado.',
    posterAlt: 'Qué se ve en la foto de portada, para quien no puede verla.',
    video: 'Dirección de un archivo de video .mp4 que se reproduce de fondo. Vacío: el video de Ajustes.',
  },
  'home.stats': { 'items[].label': 'Qué cuenta la cifra, por ejemplo «años formando familias».' },
  'home.levels': { 'items[].name': 'Nombre del nivel en la tarjeta.', 'items[].linkLabel': 'Lo que dice el enlace de la tarjeta. Vacío: «Conocer» y el nombre del nivel.' },
  'home.programs': { 'items[].name': 'Nombre del programa en la tarjeta.', footnote: 'Frase pequeña bajo las tarjetas.' },
  'home.promos': { 'items[].label': 'Palabra corta sobre el título de la tarjeta.', 'items[].title': 'Título de la tarjeta.', 'items[].text': 'Una o dos frases de la tarjeta.', 'items[].color': 'Primer color del degradado de la tarjeta.', 'items[].color2': 'Segundo color del degradado de la tarjeta.' },
  'home.strengths': { 'items[].title': 'La fortaleza del colegio, en pocas palabras.', 'items[].text': 'Una frase que la explica.' },
  'home.gallery': { images: 'Fotos de la franja. Las flechas cambian el orden.' },
  'home.lead': {
    title: 'Encabezado del formulario de informes.',
    button: 'Lo que dice el botón para enviar.',
    subject: 'Asunto con el que llega el mensaje a Mensajes, para reconocerlo.',
  },
  'home.cta': { title: 'La invitación final, por ejemplo «Agende su visita».', text: 'Una frase que anima a dar el paso.' },
  'admisiones.hero': { title: 'El título grande de la portada.' },
  'admisiones.sep': { title: 'Encabezado de la franja de incorporación a la SEP.' },
  'admisiones.steps': { 'items[].title': 'Nombre del paso, por ejemplo «Agende su visita».', 'items[].text': 'Qué hace la familia en este paso.', waLabel: 'Lo que dice el botón de WhatsApp de los pasos.' },
  'admisiones.estimator': {
    title: 'Encabezado del estimador de costos.',
    text: 'Frase que explica cómo usar el estimador.',
    sectionLabel: 'Encabezado sobre los botones de nivel.',
    startSection: 'El nivel que aparece elegido al abrir la página; escríbalo igual que uno de los niveles.',
    modalityLabel: 'Encabezado sobre los botones de nuevo ingreso y reinscripción.',
    newTag: 'Lo que dice el botón para alumnos nuevos.',
    returningTag: 'Lo que dice el botón de reinscripción.',
    adminLabel: 'Nombre del renglón de gastos administrativos en el resultado.',
    adminSub: 'Frase pequeña bajo los gastos administrativos.',
    newFeeLabel: 'Nombre del renglón de la cuota para alumnos nuevos.',
    returningFeeLabel: 'Nombre del renglón de la cuota de reinscripción.',
    feeSub: 'Frase pequeña bajo la cuota.',
    tuitionLabel: 'Nombre del renglón de la colegiatura mensual.',
    tuitionMissing: 'Lo que se muestra si ese nivel aún no tiene colegiatura publicada.',
    perMonth: 'Lo que va después de la colegiatura, por ejemplo «/ mes».',
    insuranceLabel: 'Nombre del renglón de seguros.',
    insuranceSub: 'Frase pequeña bajo los seguros.',
    noCost: 'Lo que se muestra cuando un concepto no tiene costo, por ejemplo «Sin costo».',
    allLabel: 'Lo que dice el enlace a la página de Costos.',
    allHref: 'La página a la que lleva el enlace; normalmente Costos.',
    'notes[].text': 'Una nota bajo la calculadora; el ícono ámbar la marca como aviso.',
  },
  'admisiones.faq': { 'items[].q': 'La pregunta tal como la haría una familia.', 'items[].a': 'Respuesta breve y clara.' },
  'galeria.grid': {
    'photos[].category': 'El filtro donde aparece esta foto.',
    'filters[].label': 'Lo que dice el botón del filtro, por ejemplo «Instalaciones».',
    'filters[].key': 'Se llena solo a partir del texto del botón. El filtro «todas» muestra todas las fotos; el primero de la lista es el que se ve al abrir la página.',
  },
};

// The full-coverage fields (docs/cms/full-coverage.md): same rules, kept in their own module.
for (const [type, paths] of Object.entries(COVERAGE_HELP)) OVERRIDES[type] = { ...OVERRIDES[type], ...paths };

const pattern = (label: string) => BY_SUFFIX.find(([re]) => re.test(label))?.[1];

/** Help of a field: `path` is `key` or `list[].key` (indexes removed). */
export function helpFor(type: string, path: string, f: FieldSpec): string | undefined {
  return OVERRIDES[type]?.[path] ?? f.hint ?? BY_LABEL[f.label] ?? pattern(f.label) ?? BY_KIND[f.kind];
}

/** True when the field has help written for it (not only the generic help of its kind). */
export function hasSpecificHelp(type: string, path: string, f: FieldSpec): boolean {
  return !!(OVERRIDES[type]?.[path] ?? f.hint ?? BY_LABEL[f.label] ?? pattern(f.label));
}
