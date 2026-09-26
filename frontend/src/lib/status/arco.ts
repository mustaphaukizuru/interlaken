import type { BadgeVariant } from './importRow';

/**
 * Derechos ARCO vocabulary (Data Ops C6): one map for the admin queue
 * (`AdminArco`) and the family privacy page (`PrivacyPage`). Keys match
 * `backend/apps/legal/models.py ArcoRequest`.
 */
export const ARCO_TYPE_LABEL: Record<string, string> = {
  access: 'Acceso',
  rectification: 'Rectificación',
  cancellation: 'Cancelación',
  opposition: 'Oposición',
};

export const ARCO_STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  received: { label: 'Recibida', variant: 'info' },
  in_review: { label: 'En revisión', variant: 'warning' },
  resolved: { label: 'Resuelta', variant: 'success' },
  rejected: { label: 'Rechazada', variant: 'error' },
};

export const ARCO_CHANNEL_LABEL: Record<string, string> = {
  portal: 'Portal',
  email: 'Correo',
  whatsapp: 'WhatsApp',
  in_person: 'Presencial',
};
