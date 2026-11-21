/**
 * Paso 1 · Información del alumno, in three short blocks: Nombre (as on the
 * birth certificate), Nacimiento (CURP first: it fills the rest) and Escuela
 * (grade, cycle, previous school).
 */
import { CmsAnchor } from '@/cms/sections/kit';
import { eligibilityGap } from '../choices';
import { fillText } from '../copy';
import { Field, FieldNote, RestFields } from '../fields';
import { useFichaForm } from '../context';
import { Block, Blocks, HALF, Row } from '../parts';

const PLACED = [
  'child_paternal_surname', 'child_maternal_surname', 'child_given_names', 'child_curp', 'child_dob', 'child_sex',
  'child_birth_country', 'child_birth_state', 'grade_applying', 'cycle', 'previous_school',
] as const;

export function StepAlumno() {
  const { values, copy } = useFichaForm();
  const gap = eligibilityGap(String(values.child_dob ?? ''), String(values.grade_applying ?? ''), String(values.cycle ?? ''));
  const curpLink = copy.link('curpLink');
  const curpHint = copy.t('curpHint');
  return (
    <Blocks>
      <Block title={copy.t('alumnoNameTitle')} hint={copy.t('alumnoNameHint')}>
        <Row>
          <Field name="child_paternal_surname" />
          <Field name="child_maternal_surname" />
        </Row>
        <Field name="child_given_names" />
      </Block>
      <Block title={copy.t('alumnoBirthTitle')} hint={copy.t('alumnoBirthHint')}>
        <Field
          name="child_curp"
          after={curpHint || curpLink.href ? (
            <FieldNote>
              {curpHint}{curpHint && curpLink.href ? ' ' : null}
              {curpLink.href ? (
                <CmsAnchor link={curpLink} className="font-semibold text-purple underline underline-offset-2">{curpLink.label}</CmsAnchor>
              ) : null}
            </FieldNote>
          ) : null}
        />
        <Row>
          <Field name="child_dob" />
          <Field name="child_sex" />
        </Row>
        <Row>
          <Field name="child_birth_country" />
          <Field name="child_birth_state" />
        </Row>
      </Block>
      <Block title={copy.t('alumnoSchoolTitle')} hint={copy.t('alumnoSchoolHint')}>
        <Field name="grade_applying" className={HALF} />
        <Field name="cycle" />
        {gap ? <FieldNote tone="warn">{fillText(copy.t('ageHint'), gap)}</FieldNote> : null}
        <Field name="previous_school" />
        <RestFields placed={PLACED} />
      </Block>
    </Blocks>
  );
}
