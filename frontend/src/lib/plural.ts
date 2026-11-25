/**
 * Counts that agree in number («1 compra», «3 compras»). The console used to
 * write «3 compra(s)»: Spanish has no neutral form and the «(s)» reads as a
 * form letter. Mirrors backend/apps/core/plurals.py `count`.
 */

/** The word for `n`: `one` when n is 1, else `many`. */
export function pluralWord(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** «1 compra nueva», «1,250 compras nuevas» (es-MX thousands). */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('es-MX')} ${pluralWord(n, one, many)}`;
}
