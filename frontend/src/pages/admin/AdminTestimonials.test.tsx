import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => 't'), dismiss: vi.fn() } }));
vi.mock('@/services/AdminContentApi', () => ({
  testimonialsAdminApi: { list: vi.fn(), export: vi.fn(), bulk: vi.fn() },
}));
vi.mock('@/services/api', () => ({
  contentApi: { adminDeleteTestimonial: vi.fn(), adminUpdateTestimonial: vi.fn(), adminCreateTestimonial: vi.fn() },
  downloadBlob: vi.fn(),
}));

import { testimonialsAdminApi } from '@/services/AdminContentApi';
import { contentApi } from '@/services/api';
import { renderWithProviders } from '@/test/renderWithProviders';
import { stubViewport } from '@/test/viewport';
import AdminTestimonials from './AdminTestimonials';

beforeEach(() => {
  vi.clearAllMocks();
  stubViewport(1280);
  vi.mocked(testimonialsAdminApi.list).mockResolvedValue({
    data: { count: 1, next: null, previous: null, results: [{ id: 5, quote: 'Excelente colegio', author: 'Ana', role: 'Mamá', level: '', is_published: true, order: 3, created_at: '' }] },
  } as never);
  vi.mocked(contentApi.adminUpdateTestimonial).mockResolvedValue({ data: {} } as never);
});

describe('AdminTestimonials', () => {
  it('edits the order inline and saves on Enter only when it changed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminTestimonials />, { route: '/admin/testimonios?publicado=1' });
    const input = await screen.findByRole('spinbutton', { name: 'Orden de Ana' });
    expect(testimonialsAdminApi.list).toHaveBeenCalledWith(expect.objectContaining({ published: '1' }));
    await user.click(input);
    input.blur();
    expect(contentApi.adminUpdateTestimonial).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, '1{Enter}');
    await waitFor(() => expect(contentApi.adminUpdateTestimonial).toHaveBeenCalledWith(5, { order: 1 }));
  });
});
