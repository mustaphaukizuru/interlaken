import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../../sanitize';
import { normalizeRichHtml } from './richHtml';

describe('normalizeRichHtml (visual text editor output)', () => {
  it('turns browser markup into the tags the site keeps', () => {
    expect(normalizeRichHtml('<div><b>Hola</b> <i>mundo</i></div>')).toBe('<p><strong>Hola</strong> <em>mundo</em></p>');
    expect(normalizeRichHtml('<p style="color:red" class="x"><span style="font-weight:700">texto</span></p>')).toBe('<p><span>texto</span></p>');
    expect(normalizeRichHtml('suelto <b>y</b> <h2>Subtítulo</h2>')).toBe('<p>suelto <strong>y</strong> </p><h2>Subtítulo</h2>');
    expect(normalizeRichHtml('<p>a</p><p><br></p><p></p>')).toBe('<p>a</p>');
    expect(normalizeRichHtml('<p>uno<p>dos</p></p>')).not.toContain('<p><p>');
    expect(normalizeRichHtml('<p><a href="javascript:alert(1)" onclick="x()">x</a></p>')).toBe('<p><a>x</a></p>');
  });

  it('always stores what the sanitizer would print (no change on the site)', () => {
    const samples = [
      '<p>Hola</p>',
      '<h2>Título</h2><ul><li>uno</li><li><strong>dos</strong></li></ul><ol><li>a</li></ol>',
      '<div><b>B</b><br><i>I</i></div>',
      '<p><a href="/admisiones">Admisiones</a> y <a href="https://a.mx" target="_blank">otro</a></p>',
      'texto <script>alert(1)</script> <img src=x onerror=y> <iframe></iframe>',
      '<blockquote>cita</blockquote><hr><p>{{ciclo}}</p>',
    ];
    for (const html of samples) {
      const out = normalizeRichHtml(html);
      expect(sanitizeHtml(out), html).toBe(out);
    }
  });

  it('leaves texts written with the old HTML box as they are', () => {
    const existing = '<p>Horario: {{horario}}</p><ul><li><strong>Lunes</strong> a viernes</li></ul><p><a href="/contacto">Contacto</a></p>';
    expect(normalizeRichHtml(existing)).toBe(existing);
  });
});
