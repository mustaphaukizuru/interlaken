import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StageBar, stepStates } from './StageBar';
import { describeChanges } from './CaseHistory';
import { StageChip } from '../StageChip';
import { fromLocalInput, money, phoneDigits, toLocalInput, waitingText } from '@/lib/caseStages';

describe('stepStates', () => {
  it('marks the steps before the stage done and the stage current', () => {
    expect(stepStates('examen')).toEqual({ informes: 'done', visita: 'done', examen: 'current', documentacion: 'pending', inscrito: 'pending' });
  });
  it('an enrolled case has every step done', () => {
    expect(Object.values(stepStates('inscrito'))).toEqual(['done', 'done', 'done', 'done', 'done']);
  });
  it('a closed case marks where it closed', () => {
    expect(stepStates('cerrado', 'visita')).toEqual({ informes: 'done', visita: 'closed', examen: 'pending', documentacion: 'pending', inscrito: 'pending' });
  });
});

describe('StageBar', () => {
  it('says each state in words and jumps to the card', async () => {
    const onJump = vi.fn();
    render(<StageBar stage="visita" onJump={onJump} />);
    expect(screen.getByRole('button', { name: '1. Informes: completada' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2. Visita guiada: etapa actual' })).toHaveAttribute('aria-current', 'step');
    await userEvent.click(screen.getByRole('button', { name: '4. Documentación y acuerdos: pendiente' }));
    expect(onJump).toHaveBeenCalledWith('documentacion');
  });
});

describe('StageChip', () => {
  it('icon + words, and the outcome of a closed case', () => {
    const { container } = render(<StageChip stage="cerrado" outcome="No asistió" />);
    expect(container).toHaveTextContent('Cerrado · No asistió');
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('describeChanges', () => {
  it('reads stage moves, sends, outcomes and dates', () => {
    expect(describeChanges({ stage: ['informes', 'visita'], status: ['pending', 'contacted'] })).toEqual(['Etapa: Informes → Visita guiada']);
    expect(describeChanges({ sent: 'costs', channel: 'email', email_sent: true })).toEqual(['Envío: Cuotas por nivel, por correo']);
    expect(describeChanges({ sent: 'ficha_link', channel: 'whatsapp', email_sent: false, override: true })).toEqual([
      'Envío: Liga de la ficha de inscripción, por WhatsApp', 'Excepción de administrador: Sí',
    ]);
    expect(describeChanges({ visit_outcome: ['', 'agenda_examen'] })).toEqual(['Resultado de la visita: sin dato → Asistió y agenda examen']);
    expect(describeChanges({ case: 7, voided: true, reason: 'Duplicado', summary: '$9,500.00 · transferencia' })).toEqual([
      'Anulado', 'Motivo: Duplicado', 'Detalle: $9,500.00 · transferencia',
    ]);
    expect(describeChanges({ status: ['confirmed', 'attended'] })).toEqual(['Estado: Confirmada → Asistió']);
  });
});

describe('caseStages helpers', () => {
  it('formats waits, money and phones', () => {
    expect(waitingText(0)).toBe('Hoy');
    expect(waitingText(1)).toBe('1 día');
    expect(waitingText(12)).toBe('12 días');
    expect(money('9500.00')).toContain('9,500.00');
    expect(phoneDigits('+52 (55) 1234-5678')).toBe('5512345678');
    expect(phoneDigits('123')).toBe('');
  });
  it('round-trips a datetime-local value', () => {
    const iso = fromLocalInput('2026-12-07T09:30')!;
    expect(toLocalInput(iso)).toBe('2026-12-07T09:30');
    expect(fromLocalInput('')).toBeNull();
  });
});
