import { useQuery } from '@tanstack/react-query';
import { portalApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useSelectedChildStore } from '@/store/selectedChildStore';
import type { DashboardData } from '@/types';

export type FamilyChild = NonNullable<DashboardData['children']>[number];
export type FamilyBalance = NonNullable<DashboardData['cafeteria_balances']>[number];

/**
 * The family's linked children and their wallets, read from the dashboard
 * payload the portal already loads (`['dashboard']`, shared with Inicio and
 * Mi perfil): no extra endpoint. Every family login asks for it: a parent's,
 * and a child's own school login, which most families use and which sees its
 * siblings through the Family (QA 2026-11-24). The console (admin, staff)
 * gets an empty list: its dashboard has no children.
 */
export function useFamilyChildren() {
  const isFamily = useAuthStore((s) => s.user?.role === 'parent' || s.user?.role === 'student');
  const { data, isSuccess } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await portalApi.getDashboard()).data,
    enabled: isFamily,
    staleTime: 60_000,
  });
  return {
    isFamily,
    loaded: isFamily && isSuccess,
    children: (isFamily ? data?.children : undefined) ?? [],
    balances: (isFamily ? data?.cafeteria_balances : undefined) ?? [],
  };
}

/**
 * The child every portal page is about: the one picked in the header (shared
 * store) when it belongs to this family, else the first. Never writes the
 * store itself; the pages that show one child (Inicio, Cafetería, Credencial)
 * adopt their default into it, so they all agree.
 */
export function useActiveChild() {
  const family = useFamilyChildren();
  const storedId = useSelectedChildStore((s) => s.childId);
  const active = family.children.find((c) => c.id === storedId) ?? family.children[0];
  return { ...family, active, storedId };
}

/**
 * Short names for the switcher: the first name, or the first two words when
 * siblings share it («María José» and «María Fernanda» never both read «María»).
 */
export function shortNames<T extends { id: number; name: string }>(children: T[]): Map<number, string> {
  const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;
  const out = new Map<number, string>();
  for (const c of children) {
    const f = first(c.name);
    const clash = children.some((o) => o.id !== c.id && first(o.name) === f);
    out.set(c.id, clash ? c.name.trim().split(/\s+/).slice(0, 2).join(' ') : f || c.name);
  }
  return out;
}

/** «Luis López» → { first_name: 'Luis', last_name: 'López' } for <Avatar> initials. */
export function avatarOf(name: string) {
  const words = name.trim().split(/\s+/);
  return { first_name: words[0] ?? '', last_name: words[1] ?? '', avatar: '' };
}
