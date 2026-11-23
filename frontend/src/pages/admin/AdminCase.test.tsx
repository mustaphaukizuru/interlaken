import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';

vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  downloadBlob: vi.fn(),
  admissionsAdminApi: {},
  bookingsApi: { getAdminBookings: vi.fn() },
}));
vi.mock('@/components/admin/admissions/DocumentChecklist', () => ({
  DocumentChecklist: ({ registrationId, columns }: { registrationId: number; columns?: number }) => (
    <div data-testid="checklist">{`Documentos de la ficha ${registrationId} en ${columns} columnas`}</div>
  ),
}));
vi.mock('@/components/admin/RegistrationReviewModal', () => ({
  RegistrationReviewModal: ({ open, id }: { open: boolean; id: number | null }) => (open ? <div role="dialog" aria-label="Revisión">{`Ficha #${id}`}</div> : null),
}));
vi.mock('@/hooks/useSiteSettings', () => ({ useSiteSettings: () => ({ contact_email: 'info@ejemplo.test', whatsapp_number: '' }) }));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() },
}));

import toast from 'react-hot-toast';
import AdminCase from './AdminCase';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import { gates, makeCase } from '@/test/caseFixtures';
import type { CaseDetail } from '@/hooks/queries/cases';
import type { StageKey } from '@/lib/caseStages';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);
const del = vi.mocked(api.delete);

let current: CaseDetail;

function serve(detail: CaseDetail) {
  current = detail;
  get.mockImplementation(async (url: string) => {
    if (url === `/admissions/admin/cases/${detail.id}/`) return { data: current } as never;
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderCase(id = 7) {
  return renderWithProviders(
    <Routes><Route path="/admin/admisiones/:caseId" element={<AdminCase />} /></Routes>,
    { route: `/admin/admisiones/${id}` },
  );
}

const asAdmin = () => useAuthStore.setState({ user: { id: 1, role: 'admin', email: 'admin@ejemplo.test' } as never, isAuthenticated: true });
const asStaff = () => useAuthStore.setState({ user: { id: 2, role: 'staff', staff_areas: ['admisiones'], email: 'recepcion@ejemplo.test' } as never, isAuthenticated: true });

const nextStep = () => within(screen.getByRole('group', { name: 'Siguiente paso' }));

const sendResult = (over: Record<string, unknown> = {}) => ({
  data: {
    sent: true, channel: 'email', whatsapp_text: 'Hola Marta, le compartimos las cuotas: https://ejemplo.test/cuotas/primaria.pdf',
    whatsapp_url: 'https://wa.me/525512345678?text=Hola', link: 'https://ejemplo.test/cuotas/primaria.pdf',
    sent_to: 'marta@ejemplo.test', sent_at: '2026-11-21T09:00:00-06:00', case: makeCase(), ...over,
  },
});

describe('AdminCase (Expediente)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubViewport(1280);
    asAdmin();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0; }) as typeof window.requestAnimationFrame;
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each<[StageKey, string, string]>([
    ['informes', '1. Informes: etapa actual', 'Enviar cuotas'],
    ['visita', '2. Visita guiada: etapa actual', 'Registrar resultado de la visita'],
    ['examen', '3. Examen: etapa actual', 'Agendar examen'],
    ['documentacion', '4. Documentación y acuerdos: etapa actual', 'Registrar pago de inscripción'],
  ])('renders a case in «%s»: StageBar, its card open, the next action', async (stage, step, next) => {
    serve(makeCase(stage));
    renderCase();
    expect(await screen.findByRole('heading', { level: 1, name: 'Lucía Prueba Ejemplo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: step })).toHaveAttribute('aria-current', 'step');
    const card = document.getElementById(`etapa-${stage}-toggle`)!;
    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(nextStep().getByRole('button', { name: new RegExp(next) })).toBeInTheDocument();
    // Only the current stage's card starts open.
    const others = ['informes', 'visita', 'examen', 'documentacion', 'inscrito'].filter((s) => s !== stage);
    others.forEach((s) => expect(document.getElementById(`etapa-${s}-toggle`)).toHaveAttribute('aria-expanded', 'false'));
  });

  it('an inscrito case shows the student and no next action', async () => {
    serve(makeCase('inscrito', {
      inscrito: { enrolled_at: '2026-11-20T10:00:00-06:00', payments: [], gates: gates() },
      ficha: { id: 3, status: 'complete', status_label: 'Inscripción Completa', ficha_version: 2, submitted_at: '2026-11-15T10:00:00-06:00', invite_expires_at: null, invite_used_at: null, completeness: null, documents: { state: 'complete', ok: true, detail: '', missing: [], counts: null }, student: { id: 44, student_id: '270001' } },
    }));
    renderCase();
    expect(await screen.findByText(/matrícula 270001/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir la ficha del alumno' })).toHaveAttribute('href', '/admin/alumnos/44');
    expect(screen.queryByText('Siguiente paso')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5. Inscrito: completada' })).toBeInTheDocument();
  });

  it('a closed case shows the reason and reopens with a required note', async () => {
    const user = userEvent.setup();
    serve(makeCase('cerrado'));
    post.mockResolvedValue({ data: makeCase('visita') } as never);
    renderCase();
    expect(await screen.findByText('Expediente cerrado: No le interesa')).toBeInTheDocument();
    expect(screen.getByText('Eligió otro colegio.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2. Visita guiada: aquí se cerró' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reabrir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reabrir expediente' });
    expect(within(dialog).getByLabelText('Reabrir en la etapa')).toHaveValue('visita');
    await user.click(within(dialog).getByRole('button', { name: 'Reabrir expediente' }));
    expect(within(dialog).getByText('Escriba por qué se reabre.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Motivo (obligatorio)'), 'La familia volvió a llamar.');
    await user.click(within(dialog).getByRole('button', { name: 'Reabrir expediente' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/cases/7/reopen/', { note: 'La familia volvió a llamar.', stage: 'visita' }));
    expect(toast.success).toHaveBeenCalledWith('Expediente reabierto en «Visita guiada».');
  });

  it('closes a case from «Más acciones» with outcome and reason; server errors land on the field', async () => {
    const user = userEvent.setup();
    serve(makeCase('visita'));
    post.mockRejectedValueOnce({ response: { status: 400, data: { reason: ['Indique el motivo del cierre.'] } } });
    post.mockResolvedValueOnce({ data: makeCase('cerrado') } as never);
    renderCase();
    await user.click(await screen.findByRole('button', { name: /Más acciones/ }));
    await user.click(screen.getByRole('button', { name: /Cerrar expediente/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Cerrar expediente' });
    await user.selectOptions(within(dialog).getByLabelText('Motivo de cierre'), 'no_asistio');
    await user.type(within(dialog).getByLabelText('Detalle (obligatorio)'), '   x');
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar expediente' }));
    expect(await within(dialog).findAllByText('Indique el motivo del cierre.')).not.toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar expediente' }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/admissions/admin/cases/7/close/', { outcome: 'no_asistio', reason: 'x' }));
  });

  describe('SendDialog', () => {
    it('sends by email and says to whom', async () => {
      const user = userEvent.setup();
      serve(makeCase('informes'));
      post.mockResolvedValue(sendResult() as never);
      renderCase();
      await screen.findByRole('heading', { level: 1, name: 'Lucía Prueba Ejemplo' });
      await user.click(nextStep().getByRole('button', { name: /Enviar cuotas/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Enviar cuotas' });
      expect(within(dialog).getByRole('radio', { name: /Por correo/ })).toBeChecked();
      await user.click(within(dialog).getByRole('button', { name: 'Enviar por correo' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/cases/7/actions/send-costs/', { channel: 'email' }));
      expect(toast.success).toHaveBeenCalledWith('Enviado por correo a marta@ejemplo.test.');
      expect(await within(dialog).findByText('Enviado por correo a marta@ejemplo.test')).toBeInTheDocument();
      expect(within(dialog).getByRole('status')).toHaveTextContent(/Registrado como enviado/);
    });

    it('opens WhatsApp in the tab it opened inside the tap', async () => {
      const user = userEvent.setup();
      const tab = { closed: false, opener: {}, location: { href: '' }, close: vi.fn() };
      const open = vi.spyOn(window, 'open').mockReturnValue(tab as never);
      serve(makeCase('informes'));
      post.mockResolvedValue(sendResult({ sent: false, channel: 'whatsapp', sent_to: '' }) as never);
      renderCase();
      await screen.findByRole('heading', { level: 1, name: 'Lucía Prueba Ejemplo' });
      await user.click(within(document.getElementById('etapa-informes')!).getByRole('button', { name: /Enviar liga de visita/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Enviar liga de visita' });
      await user.click(within(dialog).getByRole('radio', { name: /Por WhatsApp/ }));
      await user.click(within(dialog).getByRole('button', { name: 'Abrir WhatsApp' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/cases/7/actions/send-visit-link/', { channel: 'whatsapp' }));
      expect(open).toHaveBeenCalledWith('about:blank', '_blank');
      await waitFor(() => expect(tab.location.href).toBe('https://wa.me/525512345678?text=Hola'));
      expect(await within(dialog).findByText('Mensaje listo en WhatsApp')).toBeInTheDocument();
      open.mockRestore();
    });

    it('copies the link (registered as sent through WhatsApp)', async () => {
      const user = userEvent.setup();
      // userEvent installs its own clipboard: spy on that one.
      const writeText = vi.spyOn(navigator.clipboard, 'writeText');
      serve(makeCase('informes'));
      post.mockResolvedValue(sendResult({ sent: false, channel: 'whatsapp', sent_to: '' }) as never);
      renderCase();
      await screen.findByRole('heading', { level: 1, name: 'Lucía Prueba Ejemplo' });
      await user.click(nextStep().getByRole('button', { name: /Enviar cuotas/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Enviar cuotas' });
      await user.click(within(dialog).getByRole('radio', { name: /Copiar liga/ }));
      await user.click(within(dialog).getByRole('button', { name: 'Copiar liga' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://ejemplo.test/cuotas/primaria.pdf'));
      expect(post).toHaveBeenCalledWith('/admissions/admin/cases/7/actions/send-costs/', { channel: 'whatsapp' });
      expect(toast.success).toHaveBeenCalledWith('Liga copiada.');
    });

    it('without an email only WhatsApp and copy are offered', async () => {
      const user = userEvent.setup();
      serve(makeCase('informes', { parent_email: '' }));
      renderCase();
      await screen.findByRole('heading', { level: 1, name: 'Lucía Prueba Ejemplo' });
      await user.click(nextStep().getByRole('button', { name: /Enviar cuotas/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Enviar cuotas' });
      expect(within(dialog).getByRole('radio', { name: /Por correo/ })).toBeDisabled();
      expect(within(dialog).getByRole('radio', { name: /Por WhatsApp/ })).toBeChecked();
    });

    it('the ficha before «Aceptado»: disabled reason on the card, an administrator overrides it with a reason', async () => {
      const user = userEvent.setup();
      serve(makeCase('visita'));
      post.mockResolvedValue(sendResult({ link: 'https://ejemplo.test/pre-registro?rid=3&token=x', expires_at: '2026-12-05T10:00:00-06:00', override: true }) as never);
      renderCase();
      await user.click(await screen.findByRole('button', { name: '3. Examen: pendiente' }));
      // The card says why, with an icon and words (not colour alone).
      const button = await screen.findByRole('button', { name: 'Enviar ficha de inscripción' });
      expect(button).toHaveAccessibleDescription(/se envía cuando el examen está registrado como Aceptado\. Como administrador puede enviarla antes, con un motivo\./);
      await user.click(button);
      const dialog = await screen.findByRole('dialog', { name: 'Enviar ficha de inscripción' });
      expect(within(dialog).getByText('La ficha de inscripción se envía cuando el examen está registrado como Aceptado.')).toBeInTheDocument();
      const submit = within(dialog).getByRole('button', { name: 'Enviar por correo' });
      expect(submit).toBeDisabled();
      await user.click(within(dialog).getByRole('checkbox', { name: /Enviar de todos modos/ }));
      // The reason is required: asked for, never sent without it.
      expect(submit).toBeEnabled();
      await user.click(submit);
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Escriba por qué envía la ficha antes del resultado «Aceptado».');
      expect(post).not.toHaveBeenCalled();
      await user.type(within(dialog).getByLabelText('Motivo (obligatorio)'), 'Hermano inscrito; examen el lunes.');
      await user.click(submit);
      await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/cases/7/actions/send-ficha-link/', {
        channel: 'email', override: true, override_reason: 'Hermano inscrito; examen el lunes.',
      }));
      expect(await within(dialog).findByText(/La liga vence el/)).toBeInTheDocument();
    });

    it('a 409 «not_admitted» from the server offers the override to an administrator', async () => {
      const user = userEvent.setup();
      // The page thinks it is allowed (stale): the server refuses.
      serve(makeCase('examen', { ficha_link: { allowed: true, overridable: false, reason: '', sent_at: null, can_override: false } }));
      post.mockRejectedValueOnce({ response: { status: 409, data: { detail: 'La ficha de inscripción se envía cuando el examen está registrado como Aceptado.', code: 'not_admitted', overridable: true } } });
      post.mockResolvedValueOnce(sendResult() as never);
      renderCase();
      await user.click(await screen.findByRole('button', { name: 'Enviar ficha de inscripción' }));
      const dialog = await screen.findByRole('dialog', { name: 'Enviar ficha de inscripción' });
      await user.click(within(dialog).getByRole('button', { name: 'Enviar por correo' }));
      const override = await within(dialog).findByRole('checkbox', { name: /Enviar de todos modos/ });
      expect(within(dialog).getByText('La ficha de inscripción se envía cuando el examen está registrado como Aceptado.')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Enviar por correo' })).toBeDisabled();
      await user.click(override);
      await user.type(within(dialog).getByLabelText('Motivo (obligatorio)'), 'Autorizó la dirección.');
      await user.click(within(dialog).getByRole('button', { name: 'Enviar por correo' }));
      await waitFor(() => expect(post).toHaveBeenLastCalledWith('/admissions/admin/cases/7/actions/send-ficha-link/', {
        channel: 'email', override: true, override_reason: 'Autorizó la dirección.',
      }));
    });

    it('staff without the admin role cannot override the ficha gate', async () => {
      const user = userEvent.setup();
      asStaff();
      serve(makeCase('visita', { ficha_link: { allowed: false, overridable: true, code: 'not_admitted', reason: 'La ficha de inscripción se envía cuando el examen está registrado como Aceptado.', sent_at: null, can_override: false } }));
      renderCase();
      await user.click(await screen.findByRole('button', { name: '3. Examen: pendiente' }));
      const button = await screen.findByRole('button', { name: 'Enviar ficha de inscripción' });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription('La ficha de inscripción se envía cuando el examen está registrado como Aceptado.');
    });

    it('«Aceptado»: the next step sends the result and the ficha in one message', async () => {
      const user = userEvent.setup();
      serve(makeCase('documentacion', {
        next_action: { code: 'send_exam_result', label: 'Enviar resultado y ficha' },
        examen: { exam_at: '2026-11-18T09:00:00-06:00', exam_notes: '', exam_results_at: null, result: 'aceptado', result_label: 'Aceptado', reason: '', date_sent_at: null, result_sent_at: null },
      }));
      post.mockResolvedValue(sendResult({
        link: 'https://ejemplo.test/pre-registro?rid=3&token=x', expires_at: '2026-12-05T10:00:00-06:00', ficha_link_sent_at: '2026-11-21T10:00:00-06:00',
        whatsapp_text: '¡Felicidades, Marta Ejemplo! Lucía fue aceptado/a. Llene su ficha: https://ejemplo.test/pre-registro?rid=3&token=x (vence el 5 de diciembre de 2026).',
      }) as never);
      renderCase();
      await screen.findByRole('heading', { level: 1, name: 'Lucía Prueba Ejemplo' });
      await user.click(nextStep().getByRole('button', { name: /Enviar resultado y ficha/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Enviar resultado y ficha' });
      expect(within(dialog).getByText(/El resultado «Aceptado» y la liga personal a la ficha de inscripción, en un solo mensaje/)).toBeInTheDocument();
      // Copied, the whole message travels (it carries the link).
      expect(within(dialog).getByRole('radio', { name: /Copiar mensaje/ })).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Enviar por correo' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/cases/7/actions/send-exam-result/', { channel: 'email' }));
      // The Examen card offers the same single message.
      await user.click(screen.getByRole('button', { name: 'Listo' }));
      await user.click(within(screen.getByRole('navigation', { name: 'Etapas del proceso de admisión' })).getByRole('button', { name: /^3\. Examen/ }));
      await waitFor(() => expect(document.getElementById('etapa-examen')).not.toBeNull());
      const examen = within(document.getElementById('etapa-examen')!);
      expect(await examen.findByRole('button', { name: /Enviar resultado y ficha/ })).toBeInTheDocument();
      expect(examen.getByText('La liga va con el resultado: use «Enviar resultado y ficha».')).toBeInTheDocument();
      // «Documentación y acuerdos» says the same (no ficha yet).
      const docs = within(document.getElementById('etapa-documentacion')!);
      expect(docs.getByRole('button', { name: 'Enviar resultado y ficha' })).toBeInTheDocument();
    });
  });

  describe('Inscripción', () => {
    const ready = () => makeCase('documentacion', {
      next_action: { code: 'enroll', label: 'Marcar como inscrito' },
      inscrito: { enrolled_at: null, payments: [{ id: 1, paid_on: '2026-11-20', amount: '9500.00', method: 'transferencia', method_label: 'Transferencia', reference: 'REF-1', note: '', summary: '$9,500.00 · transferencia · 20 de noviembre de 2026 · ref. REF-1', recorded_by: 'admin@ejemplo.test', created_at: '' }], gates: gates() },
    });

    it('enrolls and shows each family login with WhatsApp and email delivery', async () => {
      const user = userEvent.setup();
      serve(ready());
      post.mockResolvedValue({ data: {
        already: false, case: makeCase('inscrito'), student: 44, student_id: '270001',
        credentials: [{ email: 'marta@ejemplo.test', password: 'Abc123xyz9', name: 'Marta Ejemplo' }], unlinked: [],
      } } as never);
      renderCase();
      await user.click(await screen.findByRole('button', { name: /Marcar como inscrito/ }));
      const dialog = await screen.findByRole('dialog', { name: /Marcar como inscrito/ });
      expect(within(dialog).getByRole('list', { name: 'Requisitos para inscribir' })).toBeInTheDocument();
      await user.type(within(dialog).getByLabelText('Grupo (opcional)'), 'b');
      await user.click(within(dialog).getByRole('button', { name: 'Crear alumno y cuentas' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/cases/7/enroll/', { student_id: undefined, grade: undefined, group: 'B' }));
      const done = await screen.findByRole('dialog', { name: 'Alumno inscrito' });
      const logins = within(done).getByRole('list', { name: 'Cuentas de familia' });
      expect(within(logins).getByText('Abc123xyz9')).toBeInTheDocument();
      expect(within(logins).getByRole('link', { name: /Enviar por WhatsApp/ })).toHaveAttribute('href', expect.stringContaining('https://wa.me/5512345678'));
      expect(within(logins).getByRole('link', { name: /Enviar por correo/ })).toHaveAttribute('href', expect.stringContaining('mailto:marta@ejemplo.test'));
      expect(within(done).getByRole('link', { name: 'Abrir la ficha del alumno' })).toHaveAttribute('href', '/admin/alumnos/44');
    });

    it('a 400 «gates» answer shows what is still missing', async () => {
      const user = userEvent.setup();
      serve(ready());
      post.mockRejectedValue({ response: { status: 400, data: { detail: 'Faltan requisitos para marcar como inscrito.', code: 'gates', gates: gates({ payment: false }) } } });
      renderCase();
      await user.click(await screen.findByRole('button', { name: /Marcar como inscrito/ }));
      const dialog = await screen.findByRole('dialog', { name: /Marcar como inscrito/ });
      await user.click(within(dialog).getByRole('button', { name: 'Crear alumno y cuentas' }));
      expect(await within(dialog).findByText('Faltan requisitos para marcar como inscrito.')).toBeInTheDocument();
      expect(within(dialog).getByText('Registre el pago de inscripción que recibió el colegio.')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Crear alumno y cuentas' })).toBeDisabled();
    });

    it('only documents missing: an administrator waives them with a reason', async () => {
      const user = userEvent.setup();
      serve(makeCase('documentacion', { inscrito: { enrolled_at: null, payments: [], gates: gates({ documents: false }) } }));
      post.mockResolvedValue({ data: { already: false, case: makeCase('inscrito'), student: 44, student_id: '270001', credentials: [], unlinked: [] } } as never);
      renderCase();
      await user.click(await screen.findByRole('button', { name: /5\. Inscrito/ }));
      expect(await screen.findByText(/como administrador puede dispensarlos/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Marcar como inscrito/ }));
      const dialog = await screen.findByRole('dialog', { name: /Marcar como inscrito/ });
      const submit = within(dialog).getByRole('button', { name: 'Crear alumno y cuentas' });
      expect(submit).toBeDisabled();
      await user.click(within(dialog).getByRole('checkbox', { name: /Inscribir sin los documentos completos/ }));
      await user.click(submit);
      expect(within(dialog).getByText('Escriba por qué se dispensan los documentos.')).toBeInTheDocument();
      await user.type(within(dialog).getByLabelText('Motivo (obligatorio)'), 'Entrega el acta en enero.');
      await user.click(submit);
      await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/cases/7/enroll/', expect.objectContaining({ override_documents: true, override_reason: 'Entrega el acta en enero.' })));
    });

    it('records a payment (no future dates) and voids one with a reason', async () => {
      const user = userEvent.setup();
      serve(ready());
      post.mockResolvedValue({ data: { id: 2, summary: '$500.00 · efectivo · 21 de noviembre de 2026' } } as never);
      del.mockResolvedValue({ data: null } as never);
      renderCase();
      await user.click(await screen.findByRole('button', { name: /5\. Inscrito/ }));
      await user.click(await screen.findByRole('button', { name: /Registrar pago/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Registrar pago de inscripción' });
      await user.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));
      expect(within(dialog).getAllByText('El monto debe ser mayor que cero.').length).toBeGreaterThan(0);
      await user.type(within(dialog).getByLabelText('Monto (MXN)'), '500');
      await user.selectOptions(within(dialog).getByLabelText('Forma de pago'), 'efectivo');
      await user.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/cases/7/payments/', expect.objectContaining({ amount: '500', method: 'efectivo' })));
      await user.click(await screen.findByRole('button', { name: /Anular el pago/ }));
      const voidDialog = await screen.findByRole('dialog', { name: 'Anular pago' });
      await user.click(within(voidDialog).getByRole('button', { name: 'Anular pago' }));
      expect(within(voidDialog).getAllByText('Indique por qué se anula el registro.').length).toBeGreaterThan(0);
      await user.type(within(voidDialog).getByLabelText('Motivo (obligatorio)'), 'Duplicado');
      await user.click(within(voidDialog).getByRole('button', { name: 'Anular pago' }));
      await waitFor(() => expect(del).toHaveBeenCalledWith('/admissions/admin/cases/7/payments/1/', { data: { reason: 'Duplicado' } }));
    });

    it('records one payment for a double click, and asks before closing a filled-in payment', async () => {
      const user = userEvent.setup();
      serve(ready());
      let resolve: (v: unknown) => void = () => {};
      post.mockImplementationOnce(() => new Promise((r) => { resolve = r; }) as never);
      renderCase();
      await user.click(await screen.findByRole('button', { name: /5\. Inscrito/ }));
      await user.click(await screen.findByRole('button', { name: /Registrar pago/ }));
      let dialog = await screen.findByRole('dialog', { name: 'Registrar pago de inscripción' });
      await user.type(within(dialog).getByLabelText('Monto (MXN)'), '500');
      await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      await user.click(within(screen.getByRole('dialog', { name: '¿Descartar los cambios?' })).getByRole('button', { name: 'Seguir editando' }));
      dialog = screen.getByRole('dialog', { name: 'Registrar pago de inscripción' });
      const submit = within(dialog).getByRole('button', { name: 'Registrar pago' });
      fireEvent.click(submit);
      fireEvent.click(submit);
      await waitFor(() => expect(post).toHaveBeenCalled());
      await waitFor(() => expect(submit).toBeDisabled());
      resolve({ data: { id: 2, summary: '$500.00 · transferencia' } });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Registrar pago de inscripción' })).toBeNull());
      expect(post).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: '¿Descartar los cambios?' })).toBeNull();
    });
  });

  describe('DiscountEditor', () => {
    it('adds a beca for a whole cycle (record only) and validates the fields', async () => {
      const user = userEvent.setup();
      serve(makeCase('documentacion'));
      post.mockResolvedValue({ data: { id: 9, summary: 'Beca 20% en colegiatura · agosto 2027 a junio 2028' } } as never);
      renderCase();
      await user.click(await screen.findByRole('button', { name: /Agregar beca o descuento/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Agregar beca o descuento' });
      await user.click(within(dialog).getByRole('button', { name: 'Agregar' }));
      expect(within(dialog).getAllByText('Escriba el porcentaje.').length).toBeGreaterThan(0);
      expect(within(dialog).getAllByText('Indique quién autorizó.').length).toBeGreaterThan(0);
      await user.type(within(dialog).getByLabelText('Porcentaje (%)'), '20');
      await user.type(within(dialog).getByLabelText('Autorizó'), 'Dirección general');
      await user.click(within(dialog).getByRole('button', { name: 'Agregar' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/cases/7/discounts/', {
        kind: 'beca_colegiatura', percent: '20', amount: null, duration: 'ciclo', start_month: null, end_month: null,
        authorized_by: 'Dirección general', note: '',
      }));
      expect(toast.success).toHaveBeenCalledWith('Agregado: Beca 20% en colegiatura · agosto 2027 a junio 2028.');
    });

    it('a fixed amount over custom months needs both months, in order', async () => {
      const user = userEvent.setup();
      serve(makeCase('documentacion'));
      post.mockResolvedValue({ data: { id: 9, summary: 'Descuento $500.00 en colegiatura · enero a marzo 2028' } } as never);
      renderCase();
      await user.click(await screen.findByRole('button', { name: /Agregar beca o descuento/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Agregar beca o descuento' });
      await user.selectOptions(within(dialog).getByLabelText('Tipo'), 'descuento_colegiatura');
      await user.click(within(dialog).getByText('Monto fijo'));
      await user.type(within(dialog).getByLabelText('Monto (MXN)'), '500');
      await user.selectOptions(within(dialog).getByLabelText('Duración'), 'personalizado');
      await user.type(within(dialog).getByLabelText('Autorizó'), 'Dirección');
      await user.click(within(dialog).getByRole('button', { name: 'Agregar' }));
      expect(within(dialog).getAllByText('Indique el primer y el último mes.').length).toBeGreaterThan(0);
      await user.type(within(dialog).getByLabelText('Primer mes'), '2028-03');
      await user.type(within(dialog).getByLabelText('Último mes'), '2028-01');
      await user.click(within(dialog).getByRole('button', { name: 'Agregar' }));
      expect(within(dialog).getAllByText('El último mes debe ser después del primero.').length).toBeGreaterThan(0);
      await user.clear(within(dialog).getByLabelText('Primer mes'));
      await user.type(within(dialog).getByLabelText('Primer mes'), '2028-01');
      await user.clear(within(dialog).getByLabelText('Último mes'));
      await user.type(within(dialog).getByLabelText('Último mes'), '2028-03');
      await user.click(within(dialog).getByRole('button', { name: 'Agregar' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/admissions/admin/cases/7/discounts/', expect.objectContaining({
        kind: 'descuento_colegiatura', percent: null, amount: '500', duration: 'personalizado', start_month: '2028-01-01', end_month: '2028-03-01',
      })));
    });

    it('lists the agreed discounts as readable lines and voids one', async () => {
      const user = userEvent.setup();
      serve(makeCase('documentacion', { documentacion: {
        documents_waived: false, documents_waived_reason: '', documents_waived_at: null, agreements_note: '',
        discounts: [{ id: 5, kind: 'beca_colegiatura', kind_label: 'Beca en colegiatura', percent: '20.00', amount: null, duration: 'ciclo', duration_label: '1 ciclo', start_month: null, end_month: null, authorized_by: 'Dirección', note: 'Hermano en Secundaria', summary: 'Beca 20% en colegiatura · agosto 2027 a junio 2028', months: 11, created_by: 'admin@ejemplo.test', created_at: '', updated_at: '' }],
      } }));
      del.mockResolvedValue({ data: null } as never);
      renderCase();
      const list = await screen.findByRole('list', { name: 'Becas y descuentos' });
      expect(within(list).getByText('Beca 20% en colegiatura · agosto 2027 a junio 2028')).toBeInTheDocument();
      expect(within(list).getByText(/Autorizó Dirección · 11 meses/)).toBeInTheDocument();
      await user.click(within(list).getByRole('button', { name: /Anular: Beca 20%/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Anular beca o descuento' });
      await user.click(within(dialog).getByRole('button', { name: 'Anular' }));
      await waitFor(() => expect(del).toHaveBeenCalledWith('/admissions/admin/cases/7/discounts/5/', { data: { reason: '' } }));
    });
  });

  it('Informes: saves only what changed and maps a server error to its field', async () => {
    const user = userEvent.setup();
    serve(makeCase('informes'));
    patch.mockRejectedValueOnce({ response: { status: 400, data: { parent_phone: ['Escriba un celular de 10 dígitos.'] } } });
    patch.mockResolvedValueOnce({ data: makeCase('informes', { parent_phone: '5598765432' }) } as never);
    renderCase();
    const phone = await screen.findByLabelText('Celular');
    await user.clear(phone);
    await user.type(phone, '123');
    await user.click(screen.getByRole('button', { name: 'Guardar datos' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admissions/admin/cases/7/informes/', { parent_phone: '123' }));
    expect(await screen.findAllByText(/Escriba un celular de 10 dígitos/)).toHaveLength(2); // inline + summary
    expect(phone).toHaveAttribute('aria-invalid', 'true');
  });

  it('Informes: a link away from the case asks first while «Datos de informes» has unsaved changes', async () => {
    const user = userEvent.setup();
    serve(makeCase('informes'));
    renderCase();
    const phone = await screen.findByLabelText('Celular');
    const back = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/admin/admisiones')!;
    await user.type(phone, '9');
    await user.click(back);
    const ask = screen.getByRole('dialog', { name: '¿Descartar los cambios?' });
    await user.click(within(ask).getByRole('button', { name: 'Seguir editando' }));
    expect(phone).toHaveValue('55123456789');
    // Put back as it was: nothing to lose, the link just works.
    await user.type(phone, '{Backspace}');
    await user.click(back);
    expect(screen.queryByRole('dialog', { name: '¿Descartar los cambios?' })).toBeNull();
  });

  it('Informes outcome «No le interesa» needs a reason before closing', async () => {
    const user = userEvent.setup();
    serve(makeCase('informes'));
    patch.mockResolvedValue({ data: makeCase('cerrado') } as never);
    renderCase();
    await user.click(await screen.findByRole('radio', { name: /No le interesa/ }));
    await user.click(screen.getByRole('button', { name: 'Guardar y cerrar expediente' }));
    expect(screen.getByText('Escriba el motivo: el expediente se cierra.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Motivo (obligatorio)'), 'Busca horario extendido.');
    await user.click(screen.getByRole('button', { name: 'Guardar y cerrar expediente' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admissions/admin/cases/7/informes/', { outcome: 'no_interesa', reason: 'Busca horario extendido.' }));
  });

  it('Examen: schedules the exam and records «Aceptado»', async () => {
    const user = userEvent.setup();
    serve(makeCase('examen'));
    patch.mockImplementation(async (_url: string, body: unknown) => {
      const b = body as Record<string, unknown>;
      current = makeCase(b.result ? 'documentacion' : 'examen', { exam_at: '2026-12-07T15:00:00.000Z', examen: { ...makeCase().examen, exam_at: '2026-12-07T15:00:00.000Z' } });
      return { data: current } as never;
    });
    renderCase();
    expect(screen.queryByRole('radio', { name: /Aceptado/ })).not.toBeInTheDocument();
    const when = await screen.findByLabelText('Fecha y hora del examen');
    await user.type(when, '2026-12-07T09:00');
    await user.click(within(document.getElementById('etapa-examen')!).getByRole('button', { name: 'Agendar examen' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admissions/admin/cases/7/examen/', { exam_at: new Date('2026-12-07T09:00').toISOString() }));
    await user.click(await screen.findByRole('radio', { name: /^Aceptado/ }));
    await user.click(screen.getByRole('button', { name: 'Guardar resultado' }));
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith('/admissions/admin/cases/7/examen/', { result: 'aceptado' }));
  });

  it('Documentación shows the ficha, its checklist in two columns and opens the review', async () => {
    const user = userEvent.setup();
    serve(makeCase('documentacion', {
      ficha: {
        id: 3, status: 'submitted', status_label: 'Enviado', ficha_version: 2, submitted_at: '2026-11-15T10:00:00-06:00',
        invite_expires_at: null, invite_used_at: null,
        completeness: { complete: false, sections: { alumno: { complete: true, missing: [] }, salud: { complete: false, missing: ['tipo_sangre'] } } },
        documents: { state: 'incomplete', ok: false, detail: 'Faltan: Acta de nacimiento.', missing: ['Acta de nacimiento'], counts: null }, student: null,
      },
    }));
    renderCase();
    expect(await screen.findByText(/1 de 2 secciones completas/)).toBeInTheDocument();
    expect(screen.getByTestId('checklist')).toHaveTextContent('Documentos de la ficha 3 en 2 columnas');
    expect(screen.getByText('Faltan: Acta de nacimiento.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dispensar documentos' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Revisar ficha/ }));
    expect(await screen.findByRole('dialog', { name: 'Revisión' })).toHaveTextContent('Ficha #3');
  });

  it('a recorded outcome stays as a line until «Cambiar el resultado»', async () => {
    const user = userEvent.setup();
    serve(makeCase('examen', { visita: { outcome: 'agenda_examen', outcome_label: 'Asistió y agenda examen', outcome_at: '2026-11-19T10:00:00-06:00', note: 'Vino con la abuela.', bookings: [] } }));
    renderCase();
    await user.click(await screen.findByRole('button', { name: '2. Visita guiada: completada' }));
    const card = document.getElementById('etapa-visita')!;
    expect(within(card).getByText('Asistió y agenda examen')).toBeInTheDocument();
    expect(within(card).queryByRole('radio')).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Cambiar el resultado o la nota' }));
    expect(within(card).getAllByRole('radio')).toHaveLength(3);
    expect(within(card).getByLabelText('Nota de la visita (opcional)')).toHaveValue('Vino con la abuela.');
  });

  it('the history reads as sentences, newest first', async () => {
    serve(makeCase('visita'));
    renderCase();
    const history = await screen.findByRole('list', { name: 'Historial del expediente' });
    const items = within(history).getAllByRole('listitem').filter((li) => li.parentElement === history);
    expect(items[0]).toHaveTextContent('Etapa: Informes → Visita guiada');
    expect(items[0]).not.toHaveTextContent('Estado');
    expect(items[1]).toHaveTextContent('Alta');
  });

  it('an unknown case says so', async () => {
    get.mockRejectedValue({ response: { status: 404, data: { detail: 'No encontrado.' } } });
    renderCase(999);
    expect(await screen.findByText('No encontramos este expediente')).toBeInTheDocument();
  });

  it('works on a 360 px phone and has no serious axe violations', async () => {
    stubViewport(360);
    serve(makeCase('examen'));
    const { container } = renderCase();
    await screen.findByRole('heading', { level: 1, name: 'Lucía Prueba Ejemplo' });
    const results = await axe(container);
    expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
  });
});
