/**
 * Runtime half of the block registry that public pages need: designed-section
 * specs register here when their page group loads, and props merge over the
 * spec defaults. The generic block catalogue (./registry BLOCKS) is editor
 * metadata and stays out of the public bundles.
 */
import type { BlockSpec } from './registry';

const SECTIONS = new Map<string, BlockSpec>();

/** Designed-section specs register here when their page group loads (cms/sections). */
export function registerBlockSpecs(specs: BlockSpec[]) {
  for (const s of specs) SECTIONS.set(s.type, s);
}

export const registeredSection = (type: string): BlockSpec | undefined => SECTIONS.get(type);

/** Props over the spec defaults, key by key: a prop added in a later release still has a value. */
export function withDefaults(spec: BlockSpec | undefined, props: Record<string, unknown>): Record<string, unknown> {
  if (!spec?.defaults) return props;
  const out: Record<string, unknown> = { ...spec.defaults };
  for (const [k, v] of Object.entries(props)) if (v !== undefined) out[k] = v;
  return out;
}
