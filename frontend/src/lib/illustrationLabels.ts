/**
 * Spanish labels of the illustrations, for the CMS editor only: section
 * chunks declare `f.illustration(...)` (kind select, optionsSet
 * 'illustrations') and the editor fills the options from here, so public pages
 * never ship these 40 strings (same idea as the icon field and cms/icons).
 */
import { ILLUSTRATION_NAMES, type IllustrationName } from './illustrations';

export const ILLUSTRATION_LABELS: Record<IllustrationName, string> = {
  informes: 'Teléfono con chat (informes)',
  visita: 'Escuela con camino (visita)',
  examen: 'Lista con lápiz (examen)',
  inscripcion: 'Sobre de bienvenida (inscripción)',
  bilingue: 'Globo terráqueo con diálogos (bilingüe)',
  academico: 'Libros con birrete (nivel académico)',
  valores: 'Corazón con brote (valores)',
  tecnologia: 'Tableta con lápiz (tecnología)',
  ecologia: 'Planta con regadera (ecología)',
  actividades: 'Trofeo con listón (actividades)',
  ciencia: 'Microscopio y matraz (ciencia)',
  teatro: 'Máscaras y notas musicales (teatro y música)',
  lectura: 'Libro abierto con lápiz (lectura)',
  oral: 'Micrófono con diálogos (expresión oral)',
  matematicas: 'Bloques y ábaco (matemáticas)',
  tareas: 'Cuaderno con reloj (tareas)',
  finanzas: 'Alcancía y puesto (finanzas)',
  campamento: 'Casa de campaña (campamentos)',
  brujula: 'Brújula y mapa (desenvolverse)',
  mundo: 'Mundo con avión de papel (mundo global)',
  experimentar: 'Bloques y lupa (experimentar)',
  crear: 'Crayones, pelota y papalote (crear y moverse)',
  convivir: 'Rompecabezas con corazón (convivir)',
  ritmo: 'Camino de piedras con bandera (ritmo propio)',
  logro: 'Medalla con estrella (logro)',
  ideas: 'Foco con engranes (ideas)',
  proposito: 'Diana con flecha (propósito)',
  comunidad: 'Casa con corazón (comunidad)',
  documentos: 'Carpeta con documentos (documentación)',
  agenda: 'Calendario con escuela (agendar)',
  costos: 'Calculadora con monedas (costos)',
  pagos: 'Recibo con tarjeta (pagos)',
  perdido: 'Avión de papel perdido (página no encontrada)',
  'sin-conexion': 'Nube desconectada (sin conexión)',
  acceso: 'Candado con llave (acceso)',
  cafeteria: 'Charola de comida (cafetería)',
  mensaje: 'Sobre con avión de papel (mensaje)',
  ubicacion: 'Pin en el mapa (ubicación)',
  arte: 'Paleta y guitarra (arte)',
  mochila: 'Mochila escolar (útiles)',
};

/** «Sin ilustración» first, then every illustration by its Spanish label. */
export const ILLUSTRATION_OPTIONS = [
  { value: 'none', label: 'Sin ilustración' },
  ...ILLUSTRATION_NAMES.map((value) => ({ value, label: ILLUSTRATION_LABELS[value] })),
];
