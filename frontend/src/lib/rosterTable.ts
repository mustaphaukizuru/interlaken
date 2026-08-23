/** Roster table preferences and sort helpers (BACKLOG P1-A8). */
export type RosterColumn = 'student_id' | 'grade' | 'group' | 'email' | 'status' | 'last_login';
export const ROSTER_COLUMNS: { key: RosterColumn; label: string; sort?: string }[] = [
  { key: 'student_id', label: 'Matrícula', sort: 'student_id' },
  { key: 'grade', label: 'Grado', sort: 'grade' },
  { key: 'group', label: 'Grupo' },
  { key: 'email', label: 'Correo' },
  { key: 'status', label: 'Estado', sort: 'status' },
  { key: 'last_login', label: 'Último acceso', sort: 'last_login' },
];
export const GRADES = [
  'Maternal', '1° Preescolar', '2° Preescolar', '3° Preescolar',
  '1° Primaria', '2° Primaria', '3° Primaria', '4° Primaria', '5° Primaria', '6° Primaria',
  '1° Secundaria', '2° Secundaria', '3° Secundaria',
];
export const NIVELES = [['maternal', 'Maternal'], ['preescolar', 'Preescolar'], ['primaria', 'Primaria'], ['secundaria', 'Secundaria']] as const;

const KEY = 'interlaken:roster-prefs';
export interface RosterPrefs { hidden: RosterColumn[]; dense: boolean }
export function readPrefs(): RosterPrefs {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.hidden)) return { hidden: v.hidden, dense: !!v.dense }; } catch { /* ignore */ }
  return { hidden: ['email'], dense: false };
}
export function writePrefs(p: RosterPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } }

/** Click on a sortable header: none → asc → desc → none. */
export function nextOrdering(current: string, key: string): string | null {
  if (current === key) return `-${key}`;
  if (current === `-${key}`) return null;
  return key;
}
export function sortIndicator(current: string, key: string): 'asc' | 'desc' | null {
  return current === key ? 'asc' : current === `-${key}` ? 'desc' : null;
}
