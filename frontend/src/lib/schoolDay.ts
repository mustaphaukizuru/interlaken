/** Today in the school's time zone (Mexico City), as YYYY-MM-DD: the corte de
 *  caja and the income report count school days, not the browser's. */
export function schoolToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
