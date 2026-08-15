/**
 * sepIncorporations.ts — registros oficiales de incorporación ante la SEP,
 * transcritos EXACTAMENTE del flyer institucional. Señales de confianza
 * mostradas en el pie de página y en Admisiones; no editar sin el documento
 * oficial a la vista.
 */

export interface SepIncorporation {
  /** Nivel educativo (para iconos/llaves de UI). */
  level: 'Preescolar' | 'Primaria' | 'Secundaria';
  /** Línea completa tal como aparece en el flyer. */
  label: string;
}

export const SEP_INCORPORATIONS: SepIncorporation[] = [
  { level: 'Preescolar', label: 'Preescolar C.T. 15PJN1703K (Acuerdo AN0253)' },
  { level: 'Primaria', label: 'Primaria Federal C.T. 15PPR1767L (Acuerdo 83043)' },
  {
    level: 'Secundaria',
    label: 'Secundaria Particular No. 0245, C.T. 15PES0730K (Acuerdo 206-016-1695-AC-052/93)',
  },
];
