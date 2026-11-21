/**
 * The ficha de inscripción endpoints (`/api/v1/admissions/`). Families act
 * with the session token the start or the invitation exchange returned
 * (`X-Session-Token`, never in a URL); staff with their login.
 */
import { api } from '@/services/api';
import { exchangeOnce } from '@/lib/inviteExchange';
import type { FichaPayload, FichaSchema, SaveResponse, StartResponse, Values } from './types';

const withSession = (token?: string) => (token ? { headers: { 'X-Session-Token': token } } : {});

export const fichaApi = {
  /** Steps, fields, choices and rules (public). */
  schema: () => api.get<FichaSchema>('/admissions/ficha/schema/'),
  /** Step 0 «Antes de empezar»: creates the draft and its lead; answers with a session. */
  start: (data: Values) => api.post<StartResponse>('/admissions/register/', data),
  /** Every section + completeness. */
  get: (id: number, session?: string) => api.get<FichaPayload>(`/admissions/register/${id}/ficha/`, withSession(session)),
  /** Save one step (format rules only: a draft may be incomplete). */
  save: (id: number, section: string, data: Values, session?: string) =>
    api.patch<SaveResponse>(`/admissions/register/${id}/ficha/${section}/`, data, withSession(session)),
  /** Full rules, privacy acceptance and the typed signature. */
  submit: (id: number, data: { accept_privacy: boolean; signed_name: string; consent_photos_media: boolean }, session?: string) =>
    api.post<{ status: string; message: string; submitted_at: string }>(`/admissions/register/${id}/submit/`, data, withSession(session)),
  /** «Reciba un enlace nuevo»: always the same neutral answer. */
  resume: (email: string) => api.post<{ detail: string }>('/admissions/register/resume/', { email }),
  /** The single-use link of an email → a session (once per token for the life of the tab). */
  exchange: (id: number, token: string) => exchangeOnce(id, token),
};
