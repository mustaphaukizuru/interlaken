/**
 * The form state the ficha's inputs read: the schema, the current step, its
 * values and errors, and how to change them. Each step renders inside
 * `<FichaFormProvider value={...}>`; a field reads it with `useFichaForm()`.
 */
import { createContext, useContext } from 'react';
import type { FichaCopy } from './copy';
import type { FichaSchema, FichaStep, FieldErrors, Values } from './types';

export interface FichaFormState {
  schema: FichaSchema;
  step: FichaStep;
  values: Values;
  errors: FieldErrors;
  set: (name: string, value: unknown) => void;
  /** Several fields at once (CURP fills, «No aplica»). */
  setMany: (patch: Values) => void;
  copy: FichaCopy;
}

const FormContext = createContext<FichaFormState | null>(null);

export const FichaFormProvider = FormContext.Provider;

export function useFichaForm(): FichaFormState {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error('useFichaForm outside FichaFormProvider');
  return ctx;
}
