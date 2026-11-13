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

export interface CodeSent {
  sent_to: string[];
  student: { name: string; first_name: string; grade: string; group: string };
  expires_in_minutes: number;
}

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
