import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import StudentCard from './StudentCard';
import { LowBalancePrompt, useLowBalancePrompt, InstallPrompt } from './CardPrompts';
import { validityLong, validityShort, validUntil } from '@/lib/credential';
import type { CafeteriaCard } from '@/types';

vi.mock('@/services/api', () => ({
  cafeteriaApi: { uploadCardPhoto: vi.fn(), removeCardPhoto: vi.fn() },
  contentApi: { getSettings: vi.fn(() => new Promise(() => {})) },
}));
import { cafeteriaApi } from '@/services/api';

const CARD = {
  student: { id: 1, name: 'Ana Quintana', grade: '3° Primaria', group: 'B', student_id: '1', tipo: 'alumno', puesto: '', puesto_label: '', photo: '' },
  code: 'ci09824', linked: true, balance: '42.00', is_low_balance: false, points: null,
  consumption: { total: '0.00', since: null }, loyverse: null,
} as unknown as CafeteriaCard;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(cafeteriaApi.uploadCardPhoto).mockReset().mockResolvedValue({ data: { photo: '/api/v1/accounts/avatar/1/x/' } } as never);
});

describe('validity', () => {
  it('runs to 31 July of the school year in progress and renews in August', () => {
    expect(validityShort(validUntil(new Date(2026, 10, 22)))).toBe('31 JUL 2027');
    expect(validityShort(validUntil(new Date(2027, 6, 31)))).toBe('31 JUL 2027');
    expect(validityShort(validUntil(new Date(2027, 7, 1)))).toBe('31 JUL 2028');
    expect(validityLong(validUntil(new Date(2027, 1, 3)))).toBe('31 de julio de 2027');
  });

  it('is printed on the card', () => {
    renderWithProviders(<StudentCard card={CARD} />);
    expect(screen.getByText('Vigencia')).toBeInTheDocument();
    expect(screen.getByText(validityShort(validUntil()))).toBeInTheDocument();
  });
});

describe('turning the card over', () => {
  it('«Ver reverso» shows the back (drawn only once asked for) and «Ver frente» turns it back', async () => {
    renderWithProviders(<StudentCard card={CARD} />);
    expect(screen.queryByText(/Personal e intransferible/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ver reverso' }));
    expect(screen.getByText(/Personal e intransferible/)).toBeInTheDocument();
    expect(document.querySelector('.cred-flip')).toHaveAttribute('data-flipped', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Ver frente' }));
    expect(document.querySelector('.cred-flip')).toHaveAttribute('data-flipped', 'false');
  });
});

describe('brothers and sisters', () => {
  it('dots move to a sibling through the shared pick', async () => {
    const onPick = vi.fn();
    renderWithProviders(<StudentCard card={CARD} siblings={[{ id: 1, name: 'Ana Quintana' }, { id: 2, name: 'Diego Quintana' }]} onPick={onPick} />);
    const group = screen.getByRole('group', { name: 'Credenciales de la familia' });
    expect(within(group).getByRole('button', { name: 'Ver credencial de Ana' })).toHaveAttribute('aria-current', 'true');
    await userEvent.click(within(group).getByRole('button', { name: 'Ver credencial de Diego' }));
    expect(onPick).toHaveBeenCalledWith(2);
  });

  it('no dots for an only child', () => {
    renderWithProviders(<StudentCard card={CARD} siblings={[{ id: 1, name: 'Ana Quintana' }]} />);
    expect(screen.queryByRole('group', { name: 'Credenciales de la familia' })).toBeNull();
  });
});

describe('counter view', () => {
  // jsdom has no PointerEvent: a MouseEvent carries the coordinates the swipe reads.
  if (!('PointerEvent' in window)) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends MouseEvent {};

  it('shows who pays and until when; swipe down closes it', async () => {
    renderWithProviders(<StudentCard card={CARD} />);
    await userEvent.click(screen.getByRole('button', { name: /pantalla completa/ }));
    const dialog = screen.getByRole('dialog', { name: 'Código para escanear en caja' });
    expect(within(dialog).getByText('Ana Quintana')).toBeInTheDocument();
    expect(within(dialog).getByText(`Vigente al ${validityLong(validUntil())}`)).toBeInTheDocument();
    fireEvent.pointerDown(dialog, { clientY: 100 });
    fireEvent.pointerUp(dialog, { clientY: 260 });
    expect(screen.queryByRole('dialog', { name: 'Código para escanear en caja' })).toBeNull();
  });
});

describe('«Subir foto»', () => {
  it('only when the school allows it', () => {
    renderWithProviders(<StudentCard card={CARD} />);
    expect(screen.queryByRole('button', { name: 'Subir foto' })).toBeNull();
  });

  it('uploads the chosen image for that child', async () => {
    renderWithProviders(<StudentCard card={{ ...CARD, can_upload_photo: true }} />);
    expect(screen.getByRole('button', { name: 'Subir foto' })).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    await userEvent.upload(input, file);
    expect(cafeteriaApi.uploadCardPhoto).toHaveBeenCalledWith(1, file);
  });
});

function Low({ card }: { card: CafeteriaCard }) {
  const p = useLowBalancePrompt(card);
  return p.open ? <LowBalancePrompt card={card} mine={false} onClose={p.close} /> : null;
}

describe('low-balance pop-up', () => {
  const low = { ...CARD, low_balance_alert: true } as CafeteriaCard;

  it('offers «Recargar ahora» for that child, once a day', async () => {
    const { unmount } = renderWithProviders(<Low card={low} />);
    const dialog = screen.getByRole('dialog', { name: 'Saldo bajo de Ana' });
    expect(within(dialog).getByRole('link', { name: 'Recargar ahora' })).toHaveAttribute('href', '/portal/cafeteria?hijo=1&recarga=200');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ahora no' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    renderWithProviders(<Low card={low} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays away when the balance is fine or the card is not active', () => {
    renderWithProviders(<><Low card={CARD} /><Low card={{ ...low, linked: false } as CafeteriaCard} /></>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('install pop-up', () => {
  it('only on touch screens, after a moment, and never again once dismissed', () => {
    vi.useFakeTimers();
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      const { unmount } = renderWithProviders(<InstallPrompt />);
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => { vi.advanceTimersByTime(1600); });
      const sheet = screen.getByRole('dialog', { name: 'Tenga la credencial a un toque' });
      fireEvent.click(within(sheet).getByRole('button', { name: 'Entendido' }));
      expect(localStorage.getItem('pwa-install-hint-dismissed')).toBe('1');
      unmount();
      renderWithProviders(<InstallPrompt />);
      act(() => { vi.advanceTimersByTime(1600); });
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      window.matchMedia = mm;
      vi.useRealTimers();
    }
  });
});
