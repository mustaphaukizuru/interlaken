import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Panel, StepHeading } from './parts';

/**
 * QA 2026-11-24, 390 px: a long word (the family's e-mail in «Guardamos su
 * avance», a long title written in Contenido) ran past the card and the
 * screen. The card and the heading block wrap long words now; jsdom has no
 * layout, so this pins the rule that does it (checked in a 390 px browser).
 */
const EMAIL = 'maria.fernanda.guadalupe.hernandez.villasenor@hotmail.com';

describe('ficha headers at phone width', () => {
  it('a status panel wraps a long e-mail inside its card', () => {
    render(<Panel icon={null} title="Guardamos su avance"><p>Enviamos a {EMAIL} un enlace para continuar.</p></Panel>);
    const card = screen.getByText(/Enviamos a/).closest('.card');
    expect(card).toHaveClass('break-words');
    expect(card).toContainElement(screen.getByRole('heading', { name: 'Guardamos su avance' }));
  });

  it('an unnumbered step heading wraps a long title', () => {
    render(<StepHeading title="Informacióndelalumnoquesedebellenarconcuidado" intro="Intro" level={1} />);
    expect(screen.getByRole('heading', { level: 1 }).closest('header')).toHaveClass('break-words');
  });
});
