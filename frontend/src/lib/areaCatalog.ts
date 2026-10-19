/**
 * Labels, descriptions and puesto presets of the admin-console areas (mirror of
 * backend apps/core/areas.py). Only the staff form needs them, so they live
 * apart from lib/areas.ts, which every page loads through the route guard.
 */
import type { AreaKey } from './areas';

export const AREAS: { key: AreaKey; label: string; description: string }[] = [
  { key: 'alumnos', label: 'Alumnos y familias', description: 'Expedientes, tutores, altas e importaciones, vínculo con Loyverse.' },
  { key: 'accesos', label: 'Accesos de familias', description: 'Solicitudes de contraseña y contraseñas temporales de padres y alumnos.' },
  { key: 'admisiones', label: 'Admisiones', description: 'Pre-registros, inscripciones, documentos y embudo.' },
  { key: 'visitas', label: 'Visitas y agenda', description: 'Citas, horarios disponibles y agenda semanal.' },
  { key: 'mensajes', label: 'Mensajes y formularios', description: 'Bandeja de contacto y respuestas de formularios del sitio.' },
  { key: 'comunicados', label: 'Comunicados y calendario', description: 'Comunicados a familias y calendario escolar.' },
  { key: 'cafeteria', label: 'Cafetería y pagos', description: 'Saldos, depósitos, carga en POS, reconciliación y pagos con tarjeta.' },
];

export const AREA_LABEL: Record<AreaKey, string> = Object.fromEntries(AREAS.map((a) => [a.key, a.label])) as Record<AreaKey, string>;

/** Ready-made puestos for the staff form ("Personalizado" = any mix). */
export const PUESTOS: { key: 'secretaria' | 'recepcion' | 'cafeteria'; label: string; areas: AreaKey[] }[] = [
  { key: 'secretaria', label: 'Secretaría', areas: ['alumnos', 'accesos', 'admisiones', 'visitas', 'mensajes', 'comunicados'] },
  { key: 'recepcion', label: 'Recepción', areas: ['visitas', 'mensajes'] },
  { key: 'cafeteria', label: 'Cafetería', areas: ['cafeteria'] },
];
