import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { loading: vi.fn(() => 't1'), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  portalApi: {
    listStaff: vi.fn(),
    exportStaff: vi.fn(),
    staffBulk: vi.fn(),
    updateStaff: vi.fn(),
    getStaffActivity: vi.fn(),
    resetStaffPassword: vi.fn(),
    inviteStaff: vi.fn(),
    grantConsoleAccess: vi.fn(),
    removeConsoleAccess: vi.fn(),
  },
  downloadBlob: vi.fn(),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: number } }) => unknown) => sel({ user: { id: 1 } }),
}));

import { portalApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminStaffUsers from './AdminStaffUsers';

const me = { id: 1, email: 'yo@x.mx', first_name: 'Yo', last_name: 'Admin', full_name: 'Yo Admin', role: 'admin', is_active: true, is_superuser: false, last_login: null, date_joined: '2026-01-01T00:00:00Z', has_password: true };
const berta = { ...me, id: 2, email: 'berta@x.mx', full_name: 'Berta Zea', role: 'staff' };
const carlos = { ...me, id: 3, email: 'carlos@x.mx', full_name: 'Carlos Alba', role: 'staff', is_active: false };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  stubViewport(1280);
  vi.mocked(portalApi.listStaff).mockResolvedValue({ data: { count: 3, next: null, previous: null, results: [me, berta, carlos] } } as never);
});

describe('AdminStaffUsers (Data Ops Phase 3)', () => {
  it('maps q, rol, activo and orden onto the list contract', async () => {
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios?q=zea&rol=staff&activo=1&orden=-last_login&page=2' });
    expect(await screen.findByText('Berta Zea')).toBeInTheDocument();
    expect(portalApi.listStaff).toHaveBeenCalledWith({ page: 2, q: 'zea', role: 'staff', active: '1', ordering: '-last_login' });
    expect(screen.getByRole('columnheader', { name: 'Último acceso' })).toHaveAttribute('aria-sort', 'descending');
    // The acting admin gets no row actions and no editable role.
    expect(screen.queryByRole('combobox', { name: 'Rol de yo@x.mx' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rol de berta@x.mx' })).toBeInTheDocument();
  });

  it('bulk deactivate runs the dry run, shows the skip reasons and commits', async () => {
    const bulk = vi.mocked(portalApi.staffBulk);
    bulk.mockImplementation(async (body) => ({
      data: {
        action: 'deactivate', requested: 3, ok: 1, failed: [], dry_run: !!body.dry_run,
        skipped: [{ id: 1, reason: 'No puede desactivar su propia cuenta.' }, { id: 3, reason: 'Ya está desactivada.' }],
      },
    }) as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await screen.findByText('Berta Zea');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todas las filas de esta página' }));
    const bar = screen.getByRole('region', { name: 'Acciones en lote' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Desactivar' }));
    const reasons = await screen.findByRole('list', { name: 'Motivos de omisión' });
    expect(reasons).toHaveTextContent('1 porque No puede desactivar su propia cuenta.');
    expect(bulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'deactivate', ids: [1, 2, 3], dry_run: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar (1)' }));
    await waitFor(() => expect(bulk).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'deactivate', dry_run: false })));
  });

  it('exports and opens the invite-by-file dialog', async () => {
    vi.mocked(portalApi.exportStaff).mockResolvedValue({ data: new Blob(['x']) } as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios?activo=0' });
    await screen.findByText('Berta Zea');
    await userEvent.click(screen.getByRole('button', { name: /^Exportar$/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /CSV/ }));
    await waitFor(() => expect(portalApi.exportStaff).toHaveBeenCalledWith({ active: '0', fmt: 'csv', ids: undefined }));
    await userEvent.click(screen.getByRole('button', { name: /Importar/ }));
    expect(await screen.findByRole('dialog', { name: 'Invitar personal desde un archivo' })).toBeInTheDocument();
  });

  it('making someone Administrador asks first, and every role change is confirmed by a toast (QA 2026-11-24)', async () => {
    const toast = (await import('react-hot-toast')).default;
    vi.mocked(portalApi.updateStaff).mockResolvedValue({ data: { ...berta, role: 'admin' } } as never);
    const user = userEvent.setup();
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await screen.findByText('Berta Zea');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Rol de berta@x.mx' }), 'admin');
    const dialog = await screen.findByRole('dialog', { name: 'Hacer administrador' });
    expect(dialog).toHaveTextContent('Berta Zea tendrá acceso completo a la consola: el dinero (cafetería y pagos), los usuarios del personal y los ajustes del colegio.');
    expect(portalApi.updateStaff).not.toHaveBeenCalled();
    // Cancelling keeps the role.
    await user.click(within(dialog).getByRole('button', { name: /Cancelar/ }));
    expect(screen.getByRole('combobox', { name: 'Rol de berta@x.mx' })).toHaveValue('staff');
    expect(portalApi.updateStaff).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Rol de berta@x.mx' }), 'admin');
    await user.click(within(await screen.findByRole('dialog', { name: 'Hacer administrador' })).getByRole('button', { name: 'Hacer administrador' }));
    await waitFor(() => expect(portalApi.updateStaff).toHaveBeenCalledWith(2, { role: 'admin' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Berta Zea ahora es Administrador.'));
  });

  it('taking the role back to Personal saves at once, with a toast', async () => {
    const toast = (await import('react-hot-toast')).default;
    const dora = { ...me, id: 4, email: 'dora@x.mx', full_name: 'Dora Paz', role: 'admin' };
    vi.mocked(portalApi.listStaff).mockResolvedValue({ data: { count: 2, next: null, previous: null, results: [me, dora] } } as never);
    vi.mocked(portalApi.updateStaff).mockResolvedValue({ data: { ...dora, role: 'staff' } } as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await screen.findByText('Dora Paz');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Rol de dora@x.mx' }), 'staff');
    await waitFor(() => expect(portalApi.updateStaff).toHaveBeenCalledWith(4, { role: 'staff' }));
    expect(screen.queryByRole('dialog', { name: 'Hacer administrador' })).toBeNull();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Dora Paz ahora es Personal.'));
  });

  it('offers «Generar contraseña» for staff rows but never for another admin', async () => {
    const dora = { ...me, id: 4, email: 'dora@x.mx', full_name: 'Dora Paz', role: 'admin' };
    vi.mocked(portalApi.listStaff).mockResolvedValue({ data: { count: 3, next: null, previous: null, results: [me, berta, dora] } } as never);
    const user = userEvent.setup();
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await screen.findByText('Dora Paz');
    await user.click(screen.getByRole('button', { name: 'Más acciones para berta@x.mx' }));
    expect(screen.getByRole('menuitem', { name: 'Generar contraseña' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Más acciones para dora@x.mx' }));
    expect(screen.queryByRole('menuitem', { name: 'Generar contraseña' })).not.toBeInTheDocument();
    // Other row actions stay available on the admin row.
    expect(screen.getByRole('menuitem', { name: 'Desactivar' })).toBeInTheDocument();
  });
});

describe('AdminStaffUsers: puesto y áreas de la consola', () => {
  it('shows each account’s puesto and areas', async () => {
    vi.mocked(portalApi.listStaff).mockResolvedValue({ data: { count: 2, next: null, previous: null, results: [
      me, { ...berta, staff_title: 'Recepción', staff_areas: ['visitas', 'mensajes'] },
    ] } } as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    expect(await screen.findByText('Recepción')).toBeInTheDocument();
    expect(screen.getByText('Visitas y agenda')).toBeInTheDocument();
    expect(screen.getByText('Todas las áreas')).toBeInTheDocument(); // the admin row
  });

  it('invites a cafeteria cashier with only the Cafetería area', async () => {
    vi.mocked(portalApi.inviteStaff).mockResolvedValue({ data: { ...berta, id: 9, temporary_password: 'Tmp-123456' } } as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await screen.findByText('Berta Zea');
    await userEvent.click(screen.getAllByRole('button', { name: /Invitar/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Invitar al personal' });
    await userEvent.type(within(dialog).getByLabelText('Correo'), 'caja@x.mx');
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'Caja');
    // Secretaría is the default puesto; switch to Cafetería.
    expect(within(dialog).getByLabelText('Admisiones')).toBeChecked();
    await userEvent.selectOptions(within(dialog).getByLabelText('Puesto'), 'cafeteria');
    expect(within(dialog).getByLabelText('Admisiones')).not.toBeChecked();
    expect(within(dialog).getByLabelText('Cafetería y pagos')).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: /Crear cuenta/ }));
    await waitFor(() => expect(portalApi.inviteStaff).toHaveBeenCalledWith(expect.objectContaining({
      email: 'caja@x.mx', role: 'staff', staff_title: 'Cafetería', staff_areas: ['cafeteria'],
    })));
  });

  // 2026-11-24: the invitation emails where to sign in (never the password).
  it.each([
    [true, 'Le enviamos un correo con el enlace para entrar. El correo no incluye la contraseña.'],
    [false, 'No se pudo enviar el correo de bienvenida.'],
  ])('says next to the one-time password whether the invitation email left (%s)', async (sent, message) => {
    vi.mocked(portalApi.inviteStaff).mockResolvedValue({ data: {
      ...berta, id: 9, email: 'caja@x.mx', temporary_password: 'Tmp-123456', invite_email_sent: sent,
    } } as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await screen.findByText('Berta Zea');
    await userEvent.click(screen.getAllByRole('button', { name: /Invitar/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Invitar al personal' });
    expect(within(dialog).getByText(/Le enviaremos un correo con el enlace para entrar, sin la contraseña/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Correo'), 'caja@x.mx');
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'Caja');
    await userEvent.click(within(dialog).getByRole('button', { name: /Crear cuenta/ }));
    const reveal = await screen.findByRole('dialog', { name: 'Contraseña temporal' });
    expect(within(reveal).getByText('Tmp-123456')).toBeInTheDocument();
    expect(within(reveal).getByText(/la primera vez que entre se le pedirá crear su propia contraseña/)).toBeInTheDocument();
    expect(within(reveal).getByRole('status')).toHaveTextContent(message);
  });

  it('a password reset (no email involved) says nothing about an email', async () => {
    vi.mocked(portalApi.resetStaffPassword).mockResolvedValue({ data: { temporary_password: 'Tmp-999999', sessions_revoked: 0 } } as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await screen.findByText('Berta Zea');
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones para berta@x.mx' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Generar contraseña/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Generar nueva contraseña' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Generar' }));
    const reveal = await screen.findByRole('dialog', { name: 'Contraseña temporal' });
    expect(within(reveal).getByText('Tmp-999999')).toBeInTheDocument();
    expect(within(reveal).queryByRole('status')).toBeNull();
  });

  it('edits the areas of a staff account from «⋯» → «Puesto y áreas»', async () => {
    vi.mocked(portalApi.updateStaff).mockResolvedValue({ data: berta } as never);
    vi.mocked(portalApi.listStaff).mockResolvedValue({ data: { count: 2, next: null, previous: null, results: [
      me, { ...berta, staff_title: 'Recepción', staff_areas: ['visitas', 'mensajes'] },
    ] } } as never);
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    // «Editar» is the one visible action; «Puesto y áreas» is in «⋯», with the same accessible name.
    expect(await screen.findByRole('button', { name: 'Editar berta@x.mx' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Puesto y áreas de berta@x.mx' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones para berta@x.mx' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Puesto y áreas de berta@x.mx' }));
    const dialog = await screen.findByRole('dialog', { name: 'Puesto y áreas de la consola' });
    expect(within(dialog).getByLabelText('Puesto')).toHaveValue('recepcion');
    await userEvent.click(within(dialog).getByLabelText('Comunicados y calendario'));
    expect(within(dialog).getByLabelText('Puesto')).toHaveValue('custom');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar acceso' }));
    await waitFor(() => expect(portalApi.updateStaff).toHaveBeenCalledWith(2, {
      staff_title: 'Recepción', staff_areas: ['visitas', 'mensajes', 'comunicados'],
    }));
  });
});

describe('AdminStaffUsers: edit, activity, archive and delete', () => {
  it('Editar saves the name and the email, and shows a server error next to the field', async () => {
    vi.mocked(portalApi.updateStaff)
      .mockRejectedValueOnce({ response: { status: 400, data: { email: ['Ya existe una cuenta con ese correo.'] } } })
      .mockResolvedValueOnce({ data: berta } as never);
    const user = userEvent.setup();
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await user.click(await screen.findByRole('button', { name: 'Editar berta@x.mx' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar cuenta' });
    const email = within(dialog).getByLabelText(/Correo/);
    await user.clear(email);
    await user.type(email, 'yo@x.mx');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await within(dialog).findByText('Ya existe una cuenta con ese correo.')).toBeInTheDocument();

    await user.clear(email);
    await user.type(email, 'berta.zea@x.mx');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(portalApi.updateStaff).toHaveBeenLastCalledWith(2, expect.objectContaining({ email: 'berta.zea@x.mx' })));
  });

  it('the name opens the account with its recent activity', async () => {
    vi.mocked(portalApi.getStaffActivity).mockResolvedValue({ data: {
      user: { ...berta, last_login: '2026-11-07T15:00:00Z' }, total_actions: 1,
      recent: [{ id: 5, actor: 2, actor_label: 'berta@x.mx', action: 'update', action_display: 'Modificación', object_type: 'accounts.studentprofile', object_id: '7', context: '', changes: { group: ['A', 'B'] }, created_at: '2026-11-07T16:00:00Z' }],
    } } as never);
    const user = userEvent.setup();
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await user.click(await screen.findByRole('button', { name: 'Ver la cuenta y la actividad de Berta Zea' }));
    const dialog = await screen.findByRole('dialog', { name: 'Berta Zea' });
    expect(await within(dialog).findByText('Grupo: A → B')).toBeInTheDocument();
    expect(within(dialog).getByText('1 acción en total')).toBeInTheDocument();
    expect(portalApi.getStaffActivity).toHaveBeenCalledWith(2);
  });

  it('the Archivadas tab lists archived accounts', async () => {
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await userEvent.click(await screen.findByRole('tab', { name: /Archivadas/ }));
    await waitFor(() => expect(portalApi.listStaff).toHaveBeenLastCalledWith(expect.objectContaining({ active: 'archivadas' })));
  });

  it('Eliminar opens on Cancelar and sends the confirmation with the commit', async () => {
    vi.mocked(portalApi.staffBulk).mockImplementation(async (body) => ({
      data: { action: body.action, requested: 1, ok: 1, failed: [], skipped: [], dry_run: !!body.dry_run, outcomes: { erased: 1 } },
    }) as never);
    const user = userEvent.setup();
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await user.click(await screen.findByRole('button', { name: 'Más acciones para berta@x.mx' }));
    await user.click(screen.getByRole('menuitem', { name: 'Eliminar' }));
    const dialog = await screen.findByRole('dialog', { name: /Eliminar: berta@x.mx/ });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus());
    expect(within(dialog).getByText(/se eliminará por completo|se eliminarán por completo/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar (1)' }));
    await waitFor(() => expect(portalApi.staffBulk).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'delete', ids: [2], dry_run: false, payload: { confirm: 'ELIMINAR' },
    })));
  });
});

// Owner, 2026-11-25: the person in charge of admissions already had a staff
// cafetería login, so «Invitar» answered «Ese correo ya está registrado».
describe('AdminStaffUsers: a staff cafetería login gets the console', () => {
  it('offers console access on the same account instead of a second one', async () => {
    vi.mocked(portalApi.inviteStaff).mockRejectedValue({ response: { status: 409, data: {
      code: 'staff_cafeteria_login', detail: 'Esa persona ya tiene cuenta de cafetería.',
      person: { id: 427, full_name: 'Rosa Lince', email: 'rlince@x.mx', puesto_label: 'Docente' },
    } } });
    vi.mocked(portalApi.grantConsoleAccess).mockResolvedValue({ data: { ...berta, id: 427, invite_email_sent: true } } as never);
    const user = userEvent.setup();
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await screen.findByText('Berta Zea');
    await user.click(screen.getAllByRole('button', { name: /Invitar/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Invitar al personal' });
    await user.type(within(dialog).getByLabelText('Correo'), 'rlince@x.mx');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Rosa');
    await user.click(within(dialog).getByRole('button', { name: /Crear cuenta/ }));
    const offer = await within(dialog).findByRole('status');
    expect(offer).toHaveTextContent('Rosa Lince ya tiene cuenta de cafetería como personal del colegio (Docente)');
    expect(within(dialog).queryByRole('button', { name: /Crear cuenta/ })).not.toBeInTheDocument();
    await user.selectOptions(within(offer).getByLabelText('Puesto'), 'admisiones');
    await user.click(within(dialog).getByRole('button', { name: /Dar acceso a la consola/ }));
    await waitFor(() => expect(portalApi.grantConsoleAccess).toHaveBeenCalledWith(427, {
      staff_title: 'Admisiones', staff_areas: ['admisiones', 'visitas', 'mensajes'],
    }));
    expect(portalApi.inviteStaff).toHaveBeenCalledTimes(1);
    const toast = (await import('react-hot-toast')).default;
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Rosa Lince ya puede entrar a la consola.'));
  });

  it('a family address keeps the server reason next to the email', async () => {
    vi.mocked(portalApi.inviteStaff).mockRejectedValue({ response: { status: 400, data: {
      email: ['Ese correo es de una familia o de un alumno: no puede ser usuario de la consola.'],
    } } });
    const user = userEvent.setup();
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    await screen.findByText('Berta Zea');
    await user.click(screen.getAllByRole('button', { name: /Invitar/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Invitar al personal' });
    await user.type(within(dialog).getByLabelText('Correo'), 'mama@x.mx');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Ana');
    await user.click(within(dialog).getByRole('button', { name: /Crear cuenta/ }));
    expect(await within(dialog).findByText(/es de una familia o de un alumno/)).toBeInTheDocument();
    expect(portalApi.grantConsoleAccess).not.toHaveBeenCalled();
  });

  it('a staff member who also buys at the cafetería loses only the console', async () => {
    const rosa = { ...berta, id: 7, email: 'rosa@x.mx', full_name: 'Rosa Lince', has_cafeteria: true, staff_title: 'Admisiones', staff_areas: ['admisiones', 'visitas', 'mensajes'] };
    vi.mocked(portalApi.listStaff).mockResolvedValue({ data: { count: 3, next: null, previous: null, results: [me, berta, rosa] } } as never);
    vi.mocked(portalApi.removeConsoleAccess).mockResolvedValue({ data: { id: 7, role: 'student', sessions_revoked: 1 } } as never);
    const user = userEvent.setup();
    renderWithProviders(<AdminStaffUsers />, { route: '/admin/usuarios' });
    expect(await screen.findByText('También compra en cafetería')).toBeInTheDocument();
    // Berta has no wallet: no such action for her.
    await user.click(screen.getByRole('button', { name: 'Más acciones para berta@x.mx' }));
    expect(screen.queryByRole('menuitem', { name: /Quitar acceso a la consola/ })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    // Desactivar warns that it would take «Mi cafetería» too.
    await user.click(screen.getByRole('button', { name: 'Más acciones para rosa@x.mx' }));
    await user.click(screen.getByRole('menuitem', { name: 'Desactivar' }));
    expect(await screen.findByText(/También perderá «Mi cafetería»/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Más acciones para rosa@x.mx' }));
    await user.click(screen.getByRole('menuitem', { name: 'Quitar acceso a la consola a rosa@x.mx' }));
    const confirm = await screen.findByRole('dialog', { name: 'Quitar acceso a la consola' });
    expect(confirm).toHaveTextContent('Su cuenta de cafetería, su saldo y su historial no cambian.');
    await user.click(within(confirm).getByRole('button', { name: 'Quitar acceso' }));
    await waitFor(() => expect(portalApi.removeConsoleAccess).toHaveBeenCalledWith(7));
  });
});
