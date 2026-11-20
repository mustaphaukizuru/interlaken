import { describe, expect, it } from 'vitest';
import type { FieldSpec } from '../blocks/registry';
import { fieldErrorsFrom, fieldErrorsFromIssues, imageIdsIn, validateFields } from './validation';

const fields: FieldSpec[] = [
  { key: 'title', label: 'Título', kind: 'text', required: true },
  { key: 'image', label: 'Foto', kind: 'image' },
  { key: 'cta', label: 'Botón', kind: 'link', required: true },
  { key: 'note', label: 'Nota', kind: 'textarea', marks: ['link'] },
  { key: 'html', label: 'Contenido', kind: 'richtext' },
  {
    key: 'items', label: 'Tarjetas', kind: 'items', item: [
      { key: 'name', label: 'Nombre', kind: 'text', required: true },
      { key: 'href', label: 'Enlace', kind: 'href' },
      { key: 'photo', label: 'Foto', kind: 'image' },
    ],
  },
];

describe('validateFields', () => {
  it('finds required, link and image problems with Spanish label chains', () => {
    const media = (id: number) => (id === 1 ? { alt: 'Fachada' } : id === 2 ? { alt: '' } : id === 3 ? null : undefined);
    const issues = validateFields(fields, {
      title: '  ',
      image: 2,
      cta: { label: 'Ir', href: '' },
      note: 'Vea [Contacto](contacto).',
      html: '<p><a href="javascript:x">x</a></p>',
      items: [{ name: 'A', href: '/ok', photo: 1 }, { name: '', href: 'sin-barra', photo: 3 }],
    }, media);
    const by = Object.fromEntries(issues.map((i) => [i.path, i]));
    expect(by.title).toMatchObject({ code: 'required', label: 'Título' });
    expect(by.image).toMatchObject({ code: 'alt' });
    expect(by.cta).toMatchObject({ code: 'required', message: 'Elija a dónde lleva el enlace.' });
    expect(by.note).toMatchObject({ code: 'link' });
    expect(by.html).toMatchObject({ code: 'link' });
    expect(by['items.1.name']).toMatchObject({ code: 'required', label: 'Tarjetas › 2 › Nombre' });
    expect(by['items.1.href']).toMatchObject({ code: 'link' });
    expect(by['items.1.photo']).toMatchObject({ code: 'missing_image' });
    expect(by['items.0.name']).toBeUndefined();
    expect(by['items.0.photo']).toBeUndefined();
  });

  it('waits for image info before flagging alt text', () => {
    expect(validateFields(fields, { title: 'x', cta: { label: 'a', href: '/' }, image: 9 }, () => undefined)).toEqual([]);
  });

  it('collects the library images of a block', () => {
    expect(imageIdsIn(fields, { image: 4, items: [{ photo: 5 }, { photo: '/assets/a.webp' }] })).toEqual([4, 5]);
  });
});

describe('server errors', () => {
  it('reads `errors` of a 400 and the located error issues of a check', () => {
    const err = { response: { status: 400, data: { detail: 'x', errors: [{ block_index: 0, block_id: 'a', block_label: 'Portada', field: 'title', field_label: 'Título', message: 'Este dato es obligatorio.' }] } } };
    expect(fieldErrorsFrom(err)).toEqual([{ block_index: 0, block_id: 'a', block_label: 'Portada', field: 'title', field_label: 'Título', message: 'Este dato es obligatorio.' }]);
    expect(fieldErrorsFrom(new Error('red'))).toEqual([]);
    expect(fieldErrorsFromIssues([
      { level: 'error', block_id: 'a', field: 'cta', message: 'largo', field_message: 'corto' },
      { level: 'warning', block_id: 'a', field: 'cta', message: 'aviso' },
      { level: 'error', block_id: null, message: 'página vacía' },
    ])).toEqual([{ block_index: undefined, block_id: 'a', block_label: undefined, field: 'cta', field_label: undefined, message: 'corto' }]);
  });
});
