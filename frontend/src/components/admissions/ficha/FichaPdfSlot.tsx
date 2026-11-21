/**
 * SLOT: «Descargar mi ficha (PDF)» on the confirmation screen.
 *
 * The PDF endpoint comes from another branch; until it lands this renders
 * nothing. Fill it in here (the confirmation already passes the ficha id and
 * the family's session token, which the download needs as X-Session-Token)
 * and the button appears under «Qué sigue» without touching the wizard.
 */
import type { ReactNode } from 'react';

export interface FichaPdfContext {
  registrationId: number;
  sessionToken: string;
  childName: string;
}

export function fichaPdfSlot(ctx: FichaPdfContext): ReactNode {
  void ctx;
  return null;
}
