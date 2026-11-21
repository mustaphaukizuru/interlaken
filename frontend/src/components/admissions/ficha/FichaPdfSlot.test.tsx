import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fichaPdfSlot } from './FichaPdfSlot';

const downloadMyFicha = vi.fn();
const fichaErrorMessage = vi.fn();
vi.mock('@/hooks/queries/fichaExports', () => ({
  downloadMyFicha: (...a: unknown[]) => downloadMyFicha(...a),
  fichaErrorMessage: (...a: unknown[]) => fichaErrorMessage(...a),
}));

const CTX = { registrationId: 42, sessionToken: 'tok-123', childName: 'Ana Prueba' };

beforeEach(() => {
  downloadMyFicha.mockReset();
  fichaErrorMessage.mockReset();
});

describe('«Descargar mi ficha (PDF)»', () => {
  it('downloads the family copy with their session and confirms it', async () => {
    downloadMyFicha.mockResolvedValue('Ficha_Prueba_Ana_2027-2028.pdf');
    render(<>{fichaPdfSlot(CTX)}</>);
    await userEvent.click(screen.getByRole('button', { name: 'Descargar mi ficha (PDF)' }));
    expect(downloadMyFicha).toHaveBeenCalledWith(42, 'tok-123');
    expect(await screen.findByRole('status')).toHaveTextContent('Listo: su ficha se descargó en PDF.');
  });

  it('shows the server’s reason when the download is refused', async () => {
    downloadMyFicha.mockRejectedValue(new Error('409'));
    fichaErrorMessage.mockResolvedValue('Su ficha aún no se envía.');
    render(<>{fichaPdfSlot(CTX)}</>);
    await userEvent.click(screen.getByRole('button', { name: 'Descargar mi ficha (PDF)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Su ficha aún no se envía.');
    expect(screen.getByRole('button', { name: 'Descargar mi ficha (PDF)' })).toBeEnabled();
  });
});
