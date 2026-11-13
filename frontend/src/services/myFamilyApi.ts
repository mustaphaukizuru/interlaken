/**
 * A family adds another child itself (2026-11-13). Backend: accounts/family_self.py.
 *
 * 1. `add({student})` with the other child's school email or matrícula sends
 *    a 6-digit code to that child's mailboxes.
 * 2. `confirm({student, code})` links the child: every login of the family
 *    then sees every child.
 */
import { api } from './api';
import type { FamilyStudent } from './familiesApi';

export interface MyFamily {
  children: FamilyStudent[];
  can_add: boolean;
}

export interface CodeSent {
  sent_to: string[];
  student: { name: string; first_name: string; grade: string; group: string };
  expires_in_minutes: number;
}

export interface Linked {
  linked: string;
  children: FamilyStudent[];
}

export const myFamilyApi = {
  get: () => api.get<MyFamily>('/accounts/me/family/'),
  add: (student: string) => api.post<CodeSent>('/accounts/me/family/add/', { student }),
  confirm: (student: string, code: string) => api.post<Linked>('/accounts/me/family/confirm/', { student, code }),
};
