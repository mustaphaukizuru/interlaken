import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { Avatar } from '@/components/ui/Avatar';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSelectedChildStore } from '@/store/selectedChildStore';
import { formatMXN } from '@/lib/format';
import { BottomSheet } from './BottomSheet';
import { avatarOf, shortNames, useActiveChild, type FamilyBalance, type FamilyChild } from './familyChildren';

/**
 * The family's one child switcher (D17, Phase 6): the active child's initials
 * and first name in the header, on every portal page. A popover on desktop, a
 * sheet on phones. Picking a child writes the shared store, so Inicio,
 * Cafetería and the Credencial all re-scope to that child. Families with one
 * child (and every console login) see nothing.
 */
export function HeaderChildSwitcher() {
  const { children, balances, active } = useActiveChild();
  const setChildId = useSelectedChildStore((s) => s.setChildId);
  const isMobile = !useMediaQuery('(min-width: 768px)');
  const [sheetOpen, setSheetOpen] = useState(false);

  if (children.length < 2 || !active) return null;
  const names = shortNames(children);
  const activeName = names.get(active.id) ?? active.name;

  const trigger = (open: boolean, toggle: () => void) => (
    <button
      type="button"
      onClick={toggle}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Alumno: ${active.name}. Cambiar de alumno`}
      className="flex h-11 min-w-0 max-w-[11rem] shrink items-center gap-2 rounded-sm pl-1 pr-2 text-left text-ink transition-colors hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:max-w-[16rem]"
    >
      <Avatar user={avatarOf(active.name)} size={32} />
      <span className="min-w-0 truncate text-[15px] font-semibold">{activeName}</span>
      <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );

  const list = (close: () => void) => (
    <div role="group" aria-label="Seleccionar alumno" className="p-1.5">
      {children.map((c) => (
        <ChildRow
          key={c.id}
          child={c}
          balance={balances.find((b) => b.student === c.id)}
          selected={c.id === active.id}
          onPick={() => { setChildId(c.id); close(); }}
        />
      ))}
    </div>
  );

  if (isMobile) {
    const close = () => setSheetOpen(false);
    return (
      <>
        {trigger(sheetOpen, () => setSheetOpen((v) => !v))}
        <BottomSheet open={sheetOpen} onClose={close} title="Elegir alumno">
          {list(close)}
        </BottomSheet>
      </>
    );
  }

  return (
    <Dropdown align="left" width={380} trigger={({ open, toggle }) => trigger(open, toggle)}>
      {({ close }) => (
        <>
          <p className="px-4 pb-1 pt-3 text-xs font-semibold text-subtle">Elegir alumno</p>
          {list(close)}
        </>
      )}
    </Dropdown>
  );
}

function ChildRow({ child, balance, selected, onPick }: {
  child: FamilyChild; balance?: FamilyBalance; selected: boolean; onPick: () => void;
}) {
  const meta = child.tipo === 'personal'
    ? child.puesto_label || 'Personal del colegio'
    : [child.grade, child.group && `Grupo ${child.group}`].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={`flex min-h-[56px] w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-cream focus-visible:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple/40 ${selected ? 'bg-purple-xlight' : ''}`}
    >
      <Avatar user={avatarOf(child.name)} size={36} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${selected ? 'font-semibold text-purple' : 'font-medium text-ink'}`}>{child.name}</span>
        {meta && <span className="block truncate text-xs text-subtle">{meta}</span>}
      </span>
      {/* The wallet is already in the dashboard payload: no extra request. */}
      {balance && (
        <span className={`flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums ${balance.low ? 'text-warning' : 'text-muted'}`}>
          {balance.low && <AlertTriangle size={16} aria-hidden="true" />}
          {formatMXN(balance.balance)}
          {balance.low && <span className="sr-only">, saldo bajo</span>}
        </span>
      )}
      <Check size={20} aria-hidden="true" className={`shrink-0 text-purple ${selected ? '' : 'invisible'}`} />
    </button>
  );
}

export default HeaderChildSwitcher;
