import { describe, expect, it } from 'vitest';
import { FileText, Users } from 'lucide-react';
import { resolveMenu } from './PublicLayout';

const fallback = [{ label: 'A', items: [{ label: 'x', to: '/x', icon: Users }] }];

describe('resolveMenu', () => {
  it('keeps the built-in menu when the CMS menu is empty', () => {
    expect(resolveMenu(undefined, fallback)).toBe(fallback);
    expect(resolveMenu([], fallback)).toBe(fallback);
  });
  it('maps icon names and falls back to FileText', () => {
    const out = resolveMenu([{ label: 'G', items: [{ label: 'a', to: '/a', icon: 'Users' }, { label: 'b', to: 'https://x.mx', icon: 'Nope' }] }], fallback);
    expect(out[0].items[0].icon).toBe(Users);
    expect(out[0].items[1].icon).toBe(FileText);
    expect(out[0].items[1].to).toBe('https://x.mx');
  });
});
