/**
 * consent.ts — minimal cookie-consent state for GDPR/LFPDPPP-style compliance.
 *
 * Analytics MUST NOT load until the visitor has explicitly accepted. This module
 * persists the decision in localStorage and lets interested modules subscribe to
 * changes (so analytics can boot the instant consent is granted).
 */
export type ConsentValue = 'granted' | 'denied';

const STORAGE_KEY = 'interlaken_cookie_consent';

type Listener = (value: ConsentValue) => void;
const listeners = new Set<Listener>();

/** Returns the stored decision, or null if the visitor hasn't chosen yet. */
export function getConsent(): ConsentValue | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

/** True once the visitor has made any choice (used to hide the banner). */
export function hasConsentDecision(): boolean {
  return getConsent() !== null;
}

export function hasAnalyticsConsent(): boolean {
  return getConsent() === 'granted';
}

/** Persist a decision and notify subscribers. */
export function setConsent(value: ConsentValue): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage may be unavailable (private mode) — decision is session-only */
  }
  listeners.forEach((cb) => cb(value));
}

/** Subscribe to consent changes. Returns an unsubscribe function. */
export function onConsentChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
