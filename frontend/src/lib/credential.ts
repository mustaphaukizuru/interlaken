/**
 * The printed student ID's wording (components/portal/CredentialFace):
 * grade pill, level, school year, SEP registration, photo size.
 */
export type Level = 'maternal' | 'preescolar' | 'primaria' | 'secundaria';

/** «2° Primaria» → primaria; «Maternal» → maternal; anything else → null. */
export function levelOf(grade: string): Level | null {
  const g = grade.toLowerCase();
  if (g.includes('maternal')) return 'maternal';
  if (g.includes('preescolar') || g.includes('kinder') || g.includes('kínder')) return 'preescolar';
  if (g.includes('primaria')) return 'primaria';
  if (g.includes('secundaria')) return 'secundaria';
  return null;
}

/**
 * The pill as printed: «5A Primaria» (grade number + group + level), «5° Primaria»
 * without a group, «Maternal». Other spellings keep the portal's «4° · Grupo A».
 */
export function gradeBadge(grade: string, group: string): string {
  const g = grade.trim();
  const m = g.match(/^(\d+)\s*°?\s*(preescolar|primaria|secundaria)$/i);
  if (m) {
    const level = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
    return group ? `${m[1]}${group} ${level}` : `${m[1]}° ${level}`;
  }
  if (/^maternal$/i.test(g)) return group ? `Maternal ${group}` : 'Maternal';
  return [g, group && `Grupo ${group}`].filter(Boolean).join(' · ');
}

/** «2026-2027»: the Mexican school year turns in August. */
export function schoolCycle(now = new Date()): string {
  const y = now.getFullYear();
  return now.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * The card is valid for the school year in progress: until 31 July of its
 * second year. Every August the card moves to the new year by itself.
 */
export function validUntil(now = new Date()): Date {
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(start + 1, 6, 31);
}
/** «31 JUL 2027» (on the card). */
export const validityShort = (d: Date) => `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3).toUpperCase()} ${d.getFullYear()}`;
/** «31 de julio de 2027» (in sentences). */
export const validityLong = (d: Date) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;

/**
 * Each level's SEP registration (C.C.T. and acuerdo), the same figures as the
 * official list in lib/sepIncorporations.ts. Copied, not imported: sharing
 * that module with the footer split it into its own chunk on the home page's
 * critical path (budget). credential.test.ts fails if the two ever differ.
 */
export const CARD_SEP: Record<'Preescolar' | 'Primaria' | 'Secundaria', { cct: string; acuerdo: string }> = {
  Preescolar: { cct: '15PJN1703K', acuerdo: 'AN0253' },
  Primaria: { cct: '15PPR1767L', acuerdo: '83043' },
  Secundaria: { cct: '15PES0730K', acuerdo: '206-016-1695-AC-052/93' },
};

/**
 * The level's registration as the printed card words it: «C.C.T. 15PJN1703K»
 * and «Incorporación AN0253» (Preescolar), «Acuerdo No.» for the others.
 */
export function sepLines(level: Level | null): { cct: string; lines: string[] } | null {
  if (!level) return null;
  const key = level === 'maternal' || level === 'preescolar' ? 'Preescolar' : level === 'primaria' ? 'Primaria' : 'Secundaria';
  const { cct, acuerdo } = CARD_SEP[key];
  if (key === 'Preescolar') return { cct, lines: [`Incorporación ${acuerdo}`] };
  return { cct, lines: acuerdo.length > 12 ? ['Acuerdo No.', acuerdo] : [`Acuerdo No. ${acuerdo}`] };
}

/**
 * Google serves the picture at the size its URL names (`=s96-c` at sign-in):
 * ask for one sharp enough for the card's frame on a retina screen.
 */
export function photoSrc(url: string): string {
  return /\.googleusercontent\.com\//.test(url) ? url.replace(/=s\d+(-c)?$/, '=s480-c') : url;
}
