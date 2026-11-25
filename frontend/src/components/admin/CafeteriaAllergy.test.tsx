import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AllergyNotice, AllergyTag } from './CafeteriaAllergy';

describe('AllergyTag (cafetería lists)', () => {
  it('marks a child whose family authorised health data', () => {
    render(<AllergyTag student={{ allergies_shared: true, allergies: ' Nueces y mariscos ' }} />);
    const tag = screen.getByText('Alergias: Nueces y mariscos');
    expect(tag.closest('span[title]')).toHaveAttribute('title', 'Alergias: Nueces y mariscos');
  });

  it('shows nothing when the switch is off, the family did not authorise, or nothing is recorded', () => {
    const { container, rerender } = render(<AllergyTag student={{ allergies: 'Nueces' }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AllergyTag student={{ allergies_shared: false }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AllergyTag student={{ allergies_shared: true, allergies: '' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AllergyNotice (per-student page)', () => {
  it('stands out with the allergies', () => {
    render(<AllergyNotice student={{ allergies_shared: true, allergies: 'Lácteos' }} />);
    const note = screen.getByRole('note', { name: 'Alergias' });
    expect(note).toHaveTextContent('Alergias: Lácteos');
    expect(note).toHaveTextContent('Dato de salud que la familia autorizó.');
  });

  it('says when none are recorded and when the family has not authorised them', () => {
    const { rerender } = render(<AllergyNotice student={{ allergies_shared: true, allergies: '' }} />);
    expect(screen.getByText('Sin alergias registradas.')).toBeInTheDocument();
    rerender(<AllergyNotice student={{ allergies_shared: false }} />);
    expect(screen.getByText('La familia no ha autorizado compartir los datos de salud: aquí no se ven sus alergias.')).toBeInTheDocument();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('renders nothing while the school switch is off (no key from the API)', () => {
    const { container } = render(<AllergyNotice student={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing about a family on a staff member\'s own wallet', () => {
    const { container } = render(<AllergyNotice student={{ tipo: 'personal', allergies_shared: false }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
