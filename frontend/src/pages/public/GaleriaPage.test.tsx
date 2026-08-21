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
    // 14 fotos distintas en "Todas" (logos removidos y duplicados
    // consolidados: varias se publicaban dos veces con nombres distintos);
    // "Instalaciones" deja 8.
    expect(screen.getAllByRole('button', { name: /ampliar imagen/i })).toHaveLength(14);
    await userEvent.click(screen.getByRole('button', { name: 'Instalaciones' }));
    expect(screen.getAllByRole('button', { name: /ampliar imagen/i })).toHaveLength(8);
  });

  it('opens the lightbox, navigates with arrow keys and closes with Escape', async () => {
    renderPage();
    await userEvent.click(
      screen.getAllByRole('button', { name: /ampliar imagen/i })[0],
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('1 / 14')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('2 / 14')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByText('1 / 14')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
