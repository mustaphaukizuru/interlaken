/**
 * eligibility.ts — mirror of backend apps/admissions/eligibility.py (BACKLOG P1-G1).
 * Required age on 31 December of the current year per grade.
 */
const BASE: Record<string, number> = { maternal: 2, preescolar: 2, primaria: 5, secundaria: 11 };

export function requiredAge(grade: string): number | null {
  const g = (grade || '').toLowerCase();
  if (g.includes('maternal')) return BASE.maternal;
  const n = Number(/(\d)/.exec(g)?.[1] ?? 1);
  for (const level of ['preescolar', 'primaria', 'secundaria']) {
    if (g.includes(level)) return BASE[level] + n;
  }
  return null;
}

export function ageOnDec31(dobIso: string, year = new Date().getFullYear()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dobIso || '');
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const before = mo < 12 || (mo === 12 && d <= 31);
  return year - y - (before ? 0 : 1);
}

/** Null when eligible (or unknown); otherwise the Spanish hint shown under the grade. */
export function eligibilityHint(dobIso: string, grade: string): string | null {
  const need = requiredAge(grade);
  const have = ageOnDec31(dobIso);
  if (need === null || have === null) return null;
  if (have === need) return null;
  const year = new Date().getFullYear();
  return `Para ${grade} el alumno debe tener ${need} años al 31 de diciembre de ${year} (tendrá ${have}).`;
}
