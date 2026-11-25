/**
 * A family adds another child itself (2026-11-13). Backend: accounts/family_self.py.
 *
 * 1. `add({student})` with the other child's school email or matrícula sends
 *    a 6-digit code to that child's mailboxes.
 * 2. `confirm({student, code})` links the child: every login of the family
 *    then sees every child.
 * 3. `remove(id)` takes a sibling back out (e.g. it finished school): only a
 *    child reached through the family (`removable`), never the account's own.
 */
import { api } from './api';
import type { FamilyStudent } from './familiesApi';

export interface MyChild extends FamilyStudent {
  /** The account's own child (its school login or a guardian link). */
  own: boolean;
  /** A sibling reached through the family: the family may take it out. */
  removable: boolean;
}

export interface MyFamily {
  children: MyChild[];
  can_add: boolean;
}

/**
 * The code left. Nothing about the other child comes back before the code
 * proves the family (anyone signed in can type a matrícula): no name, grade
 * or mailbox, only how many mailboxes got it (QA 2026-11-24).
 */
export interface CodeSent {
  sent_count: number;
  expires_in_minutes: number;
}

/** The code was right: now the child is named. */
export interface Linked {
  linked: string;
  children: MyChild[];
}

export interface Removed {
  removed: string;
  dissolved: boolean;
  children: MyChild[];
}

export const myFamilyApi = {
  get: () => api.get<MyFamily>('/accounts/me/family/'),
  add: (student: string) => api.post<CodeSent>('/accounts/me/family/add/', { student }),
  confirm: (student: string, code: string) => api.post<Linked>('/accounts/me/family/confirm/', { student, code }),
  remove: (student: number) => api.post<Removed>('/accounts/me/family/remove/', { student }),
};
