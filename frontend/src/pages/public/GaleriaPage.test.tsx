import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import GaleriaPage from './GaleriaPage';

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <GaleriaPage />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe('GaleriaPage', () => {
  it('filters photos by category', async () => {
    renderPage();
    // 23 fotos en "Todas"; "Instalaciones" deja 4.
    expect(screen.getAllByRole('button', { name: /ampliar fotografía/i })).toHaveLength(23);
    await userEvent.click(screen.getByRole('button', { name: 'Instalaciones' }));
    expect(screen.getAllByRole('button', { name: /ampliar fotografía/i })).toHaveLength(4);
  });

  it('opens the lightbox, navigates with arrow keys and closes with Escape', async () => {
    renderPage();
    await userEvent.click(
      screen.getAllByRole('button', { name: /ampliar fotografía/i })[0],
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('1 / 23')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('2 / 23')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByText('1 / 23')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
