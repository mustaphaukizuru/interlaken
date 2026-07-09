import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import NotFoundPage from './NotFoundPage';

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/ruta-inexistente']}>
        <NotFoundPage />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe('NotFoundPage', () => {
  it('shows the 404 message in Spanish', () => {
    renderPage();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Página no encontrada' }),
    ).toBeInTheDocument();
  });

  it('offers recovery links to home and contact', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /ir al inicio/i })).toHaveAttribute('href', '/');
    expect(
      screen.getByRole('link', { name: /contactar al colegio/i }),
    ).toHaveAttribute('href', '/contacto');
  });
});
