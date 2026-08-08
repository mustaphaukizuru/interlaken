/**
 * Parent multi-child selection — shared across Portal dashboard,
 * Colegiaturas, and Cafetería so the active alumno sticks while navigating.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SelectedChildState {
  /** Student profile id, or null = todos / sin preferencia. */
  childId: number | null;
  setChildId: (id: number | null) => void;
}

export const useSelectedChildStore = create<SelectedChildState>()(
  persist(
    (set) => ({
      childId: null,
      setChildId: (id) => set({ childId: id }),
    }),
    { name: 'interlaken-selected-child' },
  ),
);
