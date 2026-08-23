import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitize';

describe('sanitizeHtml', () => {
  it('keeps formatting and safe links, strips scripts/handlers/js urls', () => {
    const out = sanitizeHtml('<p onclick="x()">Hola <strong>mundo</strong></p><script>alert(1)</script><a href="javascript:alert(1)" target="_blank">x</a><img src=x><div><em>y</em></div>');
    expect(out).toContain('<p>Hola <strong>mundo</strong></p>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<img');
    expect(out).toContain('<em>y</em>');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});
