import { useState } from 'react';
import toast from 'react-hot-toast';
import { Lightbulb, UserPlus, UsersRound } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { useStudentFamily, useSuggestionsBulk } from '@/hooks/queries/families';
import { apiErrorMessage } from '@/lib/apiErrors';
import type { FamilySuggestion, FamilyStudent } from '@/services/familiesApi';
import { FamilyLinkDialog } from './FamilyLinkDialog';
import { FamilyPanel, LoginList } from './FamilyPanel';
import { CONFIDENCE, fromFamilyStudent, type FamilyLinkMode, type PickedStudent } from './familyUtils';

/** «Mismo teléfono: 55 1234 5678» chips. */
export function ReasonChips({ reasons }: { reasons: FamilySuggestion['reasons'] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Motivos">
      {reasons.map((r) => (
        <li key={`${r.kind}:${r.value}`} className="rounded-full bg-cream px-2.5 py-0.5 text-xs text-muted">
          <span className="font-semibold text-ink">{r.label}:</span> {r.value}
        </li>
      ))}
    </ul>
  );
}

/**
 * The Familia tab of a student's file: the family (siblings + accounts that
 * see them) or, without one, an empty state that offers «Vincular hermano».
 * Suggestions that include this student sit on top, each with «Revisar y
 * vincular» (opens the review step directly) and «No son hermanos».
 */
export function StudentFamily({ studentId }: { studentId: number }) {
  const { data, isLoading, isError, refetch } = useStudentFamily(studentId);
  const [linking, setLinking] = useState<{ preselected?: PickedStudent[] } | null>(null);
  const dismiss = useSuggestionsBulk();

  if (isLoading) return <Card title="Familia"><ListSkeleton rows={3} /></Card>;
  if (isError || !data) return <Card title="Familia"><ErrorState onRetry={() => refetch()} /></Card>;

  const { student, family, logins, suggestions } = data;
  const anchor = fromFamilyStudent(student);
  const mode: FamilyLinkMode = { kind: 'student', anchor };
  // The suggestion's other students: not this one, nor its current siblings.
  const others = (sg: FamilySuggestion): FamilyStudent[] => sg.students.filter(
    (s) => s.id !== student.id && !(student.family && s.family?.id === student.family.id),
  );
  const firstName = student.first_name || student.name;

  const notSiblings = (sg: FamilySuggestion) => {
    dismiss.mutate({ action: 'dismiss', ids: [sg.key] }, {
      onSuccess: () => toast.success('Sugerencia descartada: no se volverá a mostrar.'),
      onError: (e) => toast.error(apiErrorMessage(e, 'No se pudo descartar.')),
    });
  };

  return (
    <div className="space-y-6">
      {suggestions.length > 0 && (
        <Card title="Posibles hermanos" subtitle="Coinciden datos de contacto o apellidos. Revise antes de vincular.">
          <ul className="space-y-3">
            {suggestions.map((sg) => {
              const kids = others(sg);
              if (!kids.length) return null;
              return (
                <li key={sg.key} className="rounded-2xl border border-line p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber/10 text-amber">
                        <Lightbulb className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 space-y-2">
                        <p className="text-sm text-ink">
                          {kids.map((k, i) => (
                            <span key={k.id}>
                              {i > 0 && ', '}
                              <strong>{k.name}</strong> <span className="text-subtle">({k.grade}{k.group ? ` ${k.group}` : ''})</span>
                            </span>
                          ))}
                        </p>
                        <ReasonChips reasons={sg.reasons} />
                        <Badge variant={CONFIDENCE[sg.confidence].variant}>{CONFIDENCE[sg.confidence].label}</Badge>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
                      <Button type="button" size="sm" onClick={() => setLinking({ preselected: kids.map(fromFamilyStudent) })}>
                        Revisar y vincular
                      </Button>
                      <Button type="button" size="sm" variant="ghost" loading={dismiss.isPending && dismiss.variables?.ids[0] === sg.key}
                        onClick={() => notSiblings(sg)}>
                        No son hermanos
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {family ? (
        <FamilyPanel family={family} currentStudentId={student.id} onAdd={() => setLinking({})} />
      ) : (
        <Card title="Familia">
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-purple">
              <UsersRound className="h-6 w-6" />
            </span>
            <h4 className="mt-3 font-semibold text-ink">Sin hermanos vinculados</h4>
            <p className="mt-1 max-w-md text-sm text-muted">
              Si {firstName} tiene hermanos en el colegio, vincúlelos: con cualquiera de sus cuentas la familia verá a todos sus hijos en el portal.
            </p>
            <Button type="button" className="mt-4" onClick={() => setLinking({})}>
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Vincular hermano
            </Button>
          </div>
          <div className="border-t border-cream pt-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Cuentas con acceso hoy</h4>
            <LoginList logins={logins} />
          </div>
        </Card>
      )}

      <FamilyLinkDialog
        open={!!linking}
        onClose={() => setLinking(null)}
        mode={mode}
        preselected={linking?.preselected}
      />
    </div>
  );
}
