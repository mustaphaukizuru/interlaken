/** Student lifecycle labels (mirrors StudentProfile.Status on the backend). */
export const STUDENT_STATUS = {
  active: { label: 'Activo', variant: 'success' },
  on_leave: { label: 'Baja temporal', variant: 'warning' },
  graduated: { label: 'Egresado', variant: 'info' },
  withdrawn: { label: 'Baja definitiva', variant: 'neutral' },
} as const satisfies Record<string, { label: string; variant: 'success' | 'warning' | 'info' | 'neutral' }>;
