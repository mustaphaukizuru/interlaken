/** Paso 1 · Datos del alumno: names as on the birth certificate, CURP first (it fills the rest), grade and cycle. */
import { CmsAnchor } from '@/cms/sections/kit';
import { eligibilityGap } from '../choices';
import { fillText } from '../copy';
import { Field, FieldNote, RestFields } from '../fields';
import { useFichaForm } from '../context';
import { Row } from '../parts';

const PLACED = [
  'child_paternal_surname', 'child_maternal_surname', 'child_given_names', 'child_curp', 'child_dob', 'child_sex',
  'child_birth_country', 'child_birth_state', 'grade_applying', 'cycle', 'previous_school',
] as const;

export function StepAlumno() {
  const { values, copy } = useFichaForm();
  const gap = eligibilityGap(String(values.child_dob ?? ''), String(values.grade_applying ?? ''), String(values.cycle ?? ''));
  const curpLink = copy.link('curpLink');
  return (
    <div className="space-y-5">
      <Row>
        <Field name="child_paternal_surname" />
        <Field name="child_maternal_surname" />
      </Row>
      <Field name="child_given_names" />
      <Field
        name="child_curp"
        after={(
          <FieldNote>
            {copy.t('curpHint')}{' '}
            {curpLink.href ? (
              <CmsAnchor link={curpLink} className="font-semibold text-purple underline underline-offset-2">{curpLink.label}</CmsAnchor>
            ) : null}
          </FieldNote>
        )}
      />
      <Row>
        <Field name="child_dob" />
        <Field name="child_sex" />
      </Row>
      <Field name="child_birth_country" />
      <Field name="child_birth_state" />
      <Field name="grade_applying" className="sm:max-w-[50%] sm:pr-2.5" />
      <Field name="cycle" />
      {gap ? <FieldNote tone="warn">{fillText(copy.t('ageHint'), gap)}</FieldNote> : null}
      <Field name="previous_school" />
      <RestFields placed={PLACED} />
    </div>
  );
}
