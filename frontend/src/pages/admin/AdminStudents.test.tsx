import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/services/api', () => ({
  portalApi: {
    getStudents: vi.fn(),
    importStudents: vi.fn(),
    importLoyverse: vi.fn(),
    linkLoyverse: vi.fn(),
  },
}));

import AdminStudents from './AdminStudents';
import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';

const mockedStudents = vi.mocked(portalApi.getStudents);

describe('AdminStudents states', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an error state (not "Sin alumnos") and recovers on retry', async () => {
    mockedStudents
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { results: [], count: 0 } } as never);

    renderWithProviders(<AdminStudents />, { route: '/admin/alumnos' });

    expect(await screen.findByText('No se pudo cargar la información')).toBeInTheDocument();
    expect(screen.queryByText('Sin alumnos')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Sin alumnos')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo cargar la información')).toBeNull();
    expect(mockedStudents).toHaveBeenCalledTimes(2);
  });
});
