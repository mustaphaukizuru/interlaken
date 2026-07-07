import { describe, it, expect, vi } from 'vitest';
import {
  getConsent,
  hasConsentDecision,
  hasAnalyticsConsent,
  setConsent,
  onConsentChange,
} from './consent';

describe('consent store', () => {
  it('starts undecided', () => {
    expect(getConsent()).toBeNull();
    expect(hasConsentDecision()).toBe(false);
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('persists a granted decision', () => {
    setConsent('granted');
    expect(getConsent()).toBe('granted');
    expect(hasConsentDecision()).toBe(true);
    expect(hasAnalyticsConsent()).toBe(true);
    expect(localStorage.getItem('interlaken_cookie_consent')).toBe('granted');
  });

  it('treats declined as no analytics consent', () => {
    setConsent('denied');
    expect(hasConsentDecision()).toBe(true);
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('notifies subscribers on change and unsubscribes cleanly', () => {
    const cb = vi.fn();
    const off = onConsentChange(cb);
    setConsent('granted');
    expect(cb).toHaveBeenCalledWith('granted');
    off();
    setConsent('denied');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
