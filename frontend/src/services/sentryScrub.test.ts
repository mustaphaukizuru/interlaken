import { describe, expect, it } from 'vitest';
import { FILTERED, maskText, scrubBreadcrumb, scrubEvent, stripUrl } from './sentryScrub';

describe('sentry scrubbing', () => {
  it('reduces the user to its opaque id', () => {
    const event = scrubEvent({ user: { id: 42, email: 'mama@example.com', username: 'mama', ip_address: '1.2.3.4' } });
    expect(event.user).toEqual({ id: 42 });
    expect(scrubEvent({ user: { email: 'mama@example.com' } }).user).toBeUndefined();
  });

  it('drops bodies, cookies, query strings and secret headers from the request', () => {
    const event = scrubEvent({
      request: {
        url: 'https://interlaken.edu.mx/restablecer?token=abc123#x',
        query_string: 'token=abc123',
        data: { email: 'mama@example.com' },
        cookies: { sessionid: 's' },
        headers: {
          Authorization: 'Bearer eyJ',
          Referer: 'https://interlaken.edu.mx/invitacion?code=XYZ',
          'User-Agent': 'Mozilla/5.0',
        },
      },
    });
    expect(event.request).toEqual({
      url: 'https://interlaken.edu.mx/restablecer',
      query_string: FILTERED,
      headers: {
        Authorization: FILTERED,
        Referer: 'https://interlaken.edu.mx/invitacion',
        'User-Agent': 'Mozilla/5.0',
      },
    });
  });

  it('masks emails and CURPs in messages, exceptions, breadcrumbs and extras', () => {
    const event = scrubEvent({
      message: 'No se pudo enviar a papa.lopez@example.mx',
      exception: { values: [{ value: 'CURP GOMA850101HDFRRN09 inválida' }] },
      breadcrumbs: [{ category: 'fetch', data: { url: '/api/v1/accounts/lookup/?email=a@b.mx', method: 'GET' } }],
      extra: { form: { email: 'mama@example.com', grade: '3° Primaria' } },
    });
    expect(event.message).toBe('No se pudo enviar a [email]');
    expect(event.exception?.values?.[0].value).toBe('CURP [CURP] inválida');
    expect(event.breadcrumbs?.[0].data).toEqual({ url: '/api/v1/accounts/lookup/', method: 'GET' });
    expect(event.extra).toEqual({ form: { email: '[email]', grade: '3° Primaria' } });
  });

  it('strips URLs from navigation breadcrumbs and console arguments', () => {
    expect(
      scrubBreadcrumb({ category: 'navigation', data: { from: '/login?next=/portal', to: '/restablecer?token=t#k' } }).data,
    ).toEqual({ from: '/login', to: '/restablecer' });
    const consoleCrumb = scrubBreadcrumb({
      category: 'console',
      message: 'enviando mama@example.com',
      data: { arguments: [{ email: 'mama@example.com' }], logger: 'console' },
    });
    expect(consoleCrumb.message).toBe('enviando [email]');
    expect(consoleCrumb.data).toEqual({ logger: 'console' });
  });

  it('keeps plain text and URLs without secrets as they are', () => {
    expect(maskText('Saldo insuficiente')).toBe('Saldo insuficiente');
    expect(stripUrl('/portal/cafeteria')).toBe('/portal/cafeteria');
  });
});
