import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  cafeteriaApi: {
    syncHealth: vi.fn(),
    syncRoster: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import toast from 'react-hot-toast';
import { buildChecks, SyncHealthPanel } from './SyncHealthPanel';
import { cafeteriaApi, type SyncHealth } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

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
  last_poll_at: new Date().toISOString(),
  last_roster_sync_at: new Date().toISOString(),
  last_webhook_at: new Date().toISOString(),
  last_webhook_type: 'receipts.update',
  backup: {
    at: new Date().toISOString(), ok: true, path: '/var/backups/interlaken/db-x.sql.gz',
    size: 257_355, target: 'external (supabase)', offsite: 'bucket/backups/db-x.sql.gz',
    offsite_at: new Date().toISOString(),
  },
  wallet_audit: {
    at: new Date().toISOString(), compared: 10, in_sync: 10, credited: 0, drifting: 0,
    drift_total: '0', deferred: 0, unseeded: 0, stale_links: 0, unlinked_customers: 3,
    unlinked_students: 0, unmatched_receipts: 0, unmatched_points: '0',
  },
  stale_links: 0,
  unmatched_receipts: 0,
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

  it('measures the poll on when it last RAN, so a weekend with no receipts is not an outage', () => {
    // Cursor two days old (nothing sold), poll ran minutes ago: healthy.
    expect(check({ last_purchases_cursor: hoursAgo(48), last_poll_at: hoursAgo(0.1) }, 'poll').tone).toBe('ok');
    // Poll has not run for hours: the cron stopped.
    expect(check({ last_poll_at: hoursAgo(3) }, 'poll').tone).toBe('bad');
    expect(check({ last_poll_at: null, last_purchases_cursor: null }, 'poll').tone).toBe('bad');
  });

  it('falls back to the cursor against a server that has not shipped last_poll_at yet', () => {
    expect(check({ last_poll_at: null, last_purchases_cursor: hoursAgo(0.2) }, 'poll').tone).toBe('ok');
  });

  it('escalates unlinked students by how much of the roster is affected', () => {
    expect(check({ linked_students: 10 }, 'linked').tone).toBe('ok');
    expect(check({ linked_students: 8 }, 'linked').tone).toBe('warn');
    expect(check({ linked_students: 2 }, 'linked').tone).toBe('bad');
  });

  it('distinguishes "nothing polled" from "polled but recorded nothing"', () => {
    // Poll stale too → the ledger silence is merely expected, not the cause.
    expect(check({ purchases_last_7d: 0, last_poll_at: hoursAgo(3) }, 'ledger').tone)
      .toBe('warn');

    // Poll fresh but no purchases recorded → the POS is charging the wallet by
    // a route the receipt parser does not recognise. This is the real bug.
    const c = check({ purchases_last_7d: 0, last_poll_at: hoursAgo(0.1) }, 'ledger');
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

describe('buildChecks — convergence lights (2026-09-23 drift audit)', () => {
  it('drift: green when the last full pass found nobody above Loyverse', () => {
    const c = check({}, 'drift');
    expect(c.tone).toBe('ok');
    expect(c.detail).toMatch(/10 alumno\(s\) comparados/);
  });

  it('drift: amber with the peso total when wallets sit above Loyverse', () => {
    const c = check({ wallet_audit: { ...base.wallet_audit!, drifting: 27, drift_total: '-623.00' } }, 'drift');
    expect(c.tone).toBe('warn');
    expect(c.label).toMatch(/27 alumno/);
    expect(c.detail).toMatch(/\$623\.00/);
  });

  it('drift: amber, not silent, before the cron has ever compared the roster', () => {
    expect(check({ wallet_audit: null }, 'drift').tone).toBe('warn');
  });

  it('roster: names stale links, new pupils and parked receipts, and points at Dar de baja', () => {
    expect(check({}, 'roster').tone).toBe('ok');
    const c = check({ stale_links: 36, unmatched_receipts: 4,
                      wallet_audit: { ...base.wallet_audit!, unlinked_students: 2 } }, 'roster');
    expect(c.tone).toBe('warn');
    expect(c.label).toMatch(/36 enlace/);
    expect(c.label).toMatch(/2 alumno\(s\) nuevo/);
    expect(c.label).toMatch(/4 recibo/);
    expect(c.detail).toMatch(/Dar de baja/);
  });
});

describe('buildChecks — the Roster light (2026-09-24: sync_roster had never run)', () => {
  it('is green with the last run time when the daily job ran within 30 h', () => {
    const c = check({ last_roster_sync_at: hoursAgo(3) }, 'roster_sync');
    expect(c.tone).toBe('ok');
    expect(c.label).toMatch(/^Roster sincronizado hace/);
    expect(c.detail).toMatch(/06:07/);
  });

  it('is red after 30 h and names the date it last ran plus the cron hint', () => {
    const c = check({ last_roster_sync_at: hoursAgo(31) }, 'roster_sync');
    expect(c.tone).toBe('bad');
    expect(c.label).toMatch(/^El roster no se ha sincronizado desde /);
    expect(c.detail).toMatch(/sync_roster en el crontab/);
    expect(c.detail).toMatch(/Sincronizar roster ahora/);
  });

  it('is red, not "never" in fine print, when it has never run', () => {
    const c = check({ last_roster_sync_at: null }, 'roster_sync');
    expect(c.tone).toBe('bad');
    expect(c.label).toBe('El roster nunca se ha sincronizado con Loyverse');
  });
});

describe('SyncHealthPanel — Sincronizar roster ahora', () => {
  const syncHealth = vi.mocked(cafeteriaApi.syncHealth);
  const syncRoster = vi.mocked(cafeteriaApi.syncRoster);

  beforeEach(() => {
    vi.clearAllMocks();
    syncHealth.mockResolvedValue({ data: { ...base, last_roster_sync_at: hoursAgo(40) } } as never);
  });

  it('shows the red Roster light and runs the sync on click, reporting the counts', async () => {
    const user = userEvent.setup();
    syncRoster.mockResolvedValue({ data: {
      commit: true, detail: 'sync_roster (written): …', synced_at: new Date().toISOString(), stale_links: 0,
      summary: { linked: 2, conflicts: 0, created: 1, updated: 5, unchanged: 340, renamed: 3, skipped: 42,
                 errors: 0, replayed: 0, absorbed: 0, stale_links: 0, unmatched_students: 0,
                 possible_leavers: 4, unlinked_customers: 0 },
      import: { created: 1, updated: 5, unchanged: 340, renamed: 3, changes: [] },
      link: { linked: 2, already_linked: 340, possible_leavers: [] },
    } } as never);

    renderWithProviders(<SyncHealthPanel />);
    expect(await screen.findByText(/El roster no se ha sincronizado desde/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Sincronizar roster ahora/ }));

    await waitFor(() => expect(syncRoster).toHaveBeenCalledWith(false));
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      expect.stringMatching(/1 alta\(s\), 5 actualizado\(s\), 3 nombre\(s\), 2 vinculado\(s\), 4 sin grado en Loyverse/),
      expect.anything(),
    );
    // The panel re-reads the health payload so the light can turn green.
    await waitFor(() => expect(syncHealth).toHaveBeenCalledTimes(2));
  });

  it('surfaces the server detail when Loyverse is down', async () => {
    const user = userEvent.setup();
    syncRoster.mockRejectedValue({ response: { data: { detail: 'No se pudo conectar con Loyverse: 401' } } });
    renderWithProviders(<SyncHealthPanel />);
    await user.click(await screen.findByRole('button', { name: /Sincronizar roster ahora/ }));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('No se pudo conectar con Loyverse: 401'));
  });
});
