/**
 * The admissions invitation and document links carry a single-use token. Its
 * exchange runs once per token for the life of the tab, even if the section
 * that asks remounts (an app screen swaps in the school's published copy
 * after painting the built-in one, docs/cms/full-coverage.md).
 */
import { admissionsApi } from '@/services/api';

type Exchange = ReturnType<typeof admissionsApi.exchangeAccess>;
const exchanges = new Map<string, Exchange>();

export function exchangeOnce(rid: number, token: string): Exchange {
  const key = `${rid}:${token}`;
  if (!exchanges.has(key)) exchanges.set(key, admissionsApi.exchangeAccess(rid, token));
  return exchanges.get(key)!;
}
