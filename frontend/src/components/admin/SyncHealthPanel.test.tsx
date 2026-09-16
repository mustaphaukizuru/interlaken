import { describe, it, expect } from 'vitest';
import { buildChecks } from './SyncHealthPanel';
import type { SyncHealth } from '@/services/api';

const base: SyncHealth = {
  loyverse_ok: true,
  loyverse_error: '',
  last_purchases_cursor: new Date().toISOString(),
  last_full_fetch_at: new Date().toISOString(),
  active_students: 10,
  linked_students: 10,
  last_transaction_at: new Date().toISOString(),
  transactions_last_7d: 12,
  purchases_last_7d: 12,
  last_webhook_at: new Date().toISOString(),
  last_webhook_type: 'receipts.update',
  backup: {
    at: new Date().toISOString(), ok: true, path: '/var/backups/interlaken/db-x.sql.gz',
    size: 257_355, target: 'external (supabase)', offsite: 'bucket/backups/db-x.sql.gz',
    offsite_at: new Date().toISOString(),
  },
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 36e5).toISOString();
const check = (h: Partial<SyncHealth>, key: string) =>
  buildChecks({ ...base, ...h }).find((c) => c.key === key)!;

describe('buildChecks — the four questions the sync panel answers', () => {
  it('is all-clear when everything is current', () => {
    expect(buildChecks(base).every((c) => c.tone === 'ok')).toBe(true);
  });

  it('flags a dead Loyverse token as the blocking failure', () => {
    const c = check({ loyverse_ok: false, loyverse_error: '401 Unauthorized' }, 'api');
    expect(c.tone).toBe('bad');
    expect(c.detail).toContain('401');
  });

  it('flags a stale poll cursor — the cron-not-running case', () => {
    expect(check({ last_purchases_cursor: hoursAgo(48) }, 'poll').tone).toBe('bad');
    expect(check({ last_purchases_cursor: null }, 'poll').tone).toBe('bad');
    expect(check({ last_purchases_cursor: hoursAgo(1) }, 'poll').tone).toBe('ok');
  });

  it('escalates unlinked students by how much of the roster is affected', () => {
    expect(check({ linked_students: 10 }, 'linked').tone).toBe('ok');
    expect(check({ linked_students: 8 }, 'linked').tone).toBe('warn');
    expect(check({ linked_students: 2 }, 'linked').tone).toBe('bad');
  });

  it('distinguishes "nothing polled" from "polled but recorded nothing"', () => {
    // Poll stale too → the ledger silence is merely expected, not the cause.
    expect(check({ purchases_last_7d: 0, last_purchases_cursor: hoursAgo(48) }, 'ledger').tone)
      .toBe('warn');

    // Poll fresh but no purchases recorded → the POS is charging the wallet by
    // a route the receipt parser does not recognise. This is the real bug.
    const c = check({ purchases_last_7d: 0, last_purchases_cursor: hoursAgo(1) }, 'ledger');
    expect(c.tone).toBe('bad');
    expect(c.detail).toContain('no reconoce');
  });
});

describe('buildChecks — real-time and backup lights', () => {
  it('warns (not fails) when Loyverse has not delivered in a school day: the poll still runs', () => {
    expect(check({ last_webhook_at: hoursAgo(1) }, 'webhook').tone).toBe('ok');
    expect(check({ last_webhook_at: hoursAgo(40) }, 'webhook').tone).toBe('warn');
    expect(check({ last_webhook_at: null }, 'webhook').tone).toBe('warn');
  });

  it('backup: green with an off-site copy, amber without one, red when stale or failed', () => {
    expect(check({}, 'backup').tone).toBe('ok');
    expect(check({ backup: { ...base.backup!, offsite: null, offsite_at: null } }, 'backup').tone).toBe('warn');
    expect(check({ backup: { ...base.backup!, at: hoursAgo(50) } }, 'backup').tone).toBe('bad');
    expect(check({ backup: { ...base.backup!, ok: false } }, 'backup').tone).toBe('bad');
    expect(check({ backup: null }, 'backup').tone).toBe('bad');
    expect(check({ backup: { ...base.backup!, ok: false } }, 'backup').label).toMatch(/falló/);
  });
});

