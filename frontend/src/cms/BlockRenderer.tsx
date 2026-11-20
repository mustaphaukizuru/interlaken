/**
 * Renders a list of CMS blocks: the designed sections of each public page
 * (cms/sections, CMS-COMPLETION-PLAN) and the generic blocks (CMS-PLAN phase 2).
 * Hidden blocks never render; unknown types render nothing (never crash the page).
 *
 * Public code path only: the generic blocks load on demand (./blocks/generic)
 * and the editor's selectable preview lives in cms/editor/EditableBlocks, so a
 * designed page downloads neither.
 */
import { lazy, Suspense, useEffect, useReducer } from 'react';
import { withDefaults } from './blocks/specs';
import type { Block } from './blocks/registry';
import { groupOf, isGroupLoaded, sectionSpec } from './sections';

const GenericBlockView = lazy(() => import('./blocks/generic'));

/** Generic blocks have plain type names; designed sections are `<group>.<name>`. */
export const isGenericBlock = (b: Pick<Block, 'type'>) => !b.type.includes('.');

export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  const visible = blocks.filter((b) => !b.hidden);
  const list = <>{visible.map((b) => <BlockView key={b.id} block={b} />)}</>;
  // One boundary for the whole page: a page with generic blocks appears at
  // once when their chunk arrives, holding the screen so the footer stays put.
  return visible.some(isGenericBlock) ? <Suspense fallback={<div className="min-h-screen" aria-busy="true" />}>{list}</Suspense> : list;
}

/** A designed section; its page group loads on demand when another page reuses it. */
function SectionView({ block }: { block: Block }) {
  const group = groupOf(block.type);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const ready = isGroupLoaded(group);
  useEffect(() => { if (!ready) void import('./sections/loaders').then((m) => m.loadGroup(group)).then(rerender); }, [group, ready]);
  const spec = sectionSpec(block.type);
  if (!spec) return null;
  const Component = spec.component;
  return <Component {...withDefaults(spec, block.props)} />;
}

export function BlockView({ block }: { block: Block }) {
  return isGenericBlock(block) ? <GenericBlockView block={block} /> : <SectionView block={block} />;
}
