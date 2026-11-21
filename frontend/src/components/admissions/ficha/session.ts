/**
 * The family's ficha session (24 h, from the start or the link exchange),
 * kept for the life of the TAB in sessionStorage: an iPhone that reloads a
 * background tab must not cost the family a new email link. It never goes in
 * a URL, and it is dropped on submit, on expiry and when the server refuses it.
 */
export interface FichaSession { id: number; token: string; expires?: string | null }

const KEY = 'interlaken:ficha-session';

export function loadSession(): FichaSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as FichaSession;
    if (!s || typeof s.id !== 'number' || typeof s.token !== 'string' || !s.token) return null;
    if (s.expires && Date.parse(s.expires) <= Date.now()) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: FichaSession): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode / storage full: the session still lives in memory.
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
