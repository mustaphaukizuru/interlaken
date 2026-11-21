/**
 * Pasos 4 y 5 · Información del padre / de la madre (one block of the Excel
 * each), in four short blocks: Datos personales, Nacimiento y CURP, Estudios
 * y ocupación, Contacto. «No aplica» collapses the step; when it already
 * holds data the family confirms first, because the server keeps no personal
 * data for a block that does not apply. «Es tutor/a legal» is a plain switch.
 */
import { useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { isBlank } from '../choices';
import { Field, FieldNote, RestFields } from '../fields';
import { FichaFormProvider, useFichaForm, type FichaFormState } from '../context';
import { Block, Blocks, Row } from '../parts';
import type { Values } from '../types';

const FLAGS = ['not_applicable', 'is_legal_guardian'];
const PLACED = [
  ...FLAGS, 'paternal_surname', 'maternal_surname', 'given_names', 'curp', 'sex', 'dob', 'birth_country', 'birth_state',
  'marital_status', 'education_level', 'occupation', 'occupation_other', 'mobile', 'office_phone', 'office_ext', 'email',
] as const;

export function StepTutor({ prefilled }: { prefilled?: boolean }) {
  const form = useFichaForm();
  const [confirming, setConfirming] = useState(false);
  const { step, values, copy } = form;
  const notApplicable = values.not_applicable === true;

  /** Everything but the flags, emptied as the server does for «No aplica». */
  const cleared = useMemo(() => {
    const out: Values = { not_applicable: true };
    for (const f of step.fields) {
      if (f.read_only || f.name === 'not_applicable') continue;
      out[f.name] = f.type === 'boolean' ? false : '';
    }
    return out;
  }, [step]);
  const hasData = step.fields.some((f) => !f.read_only && !FLAGS.includes(f.name)
    && !isBlank(values[f.name]) && values[f.name] !== f.default);

  const guarded: FichaFormState = {
    ...form,
    set: (name, value) => {
      if (name === 'not_applicable' && value === true) {
        if (hasData) setConfirming(true);
        else form.setMany(cleared);
        return;
      }
      form.set(name, value);
    },
  };

  return (
    <FichaFormProvider value={guarded}>
      <Blocks>
        <Field name="not_applicable" />
        {notApplicable ? (
          <FieldNote>{copy.t('naCollapsed')}</FieldNote>
        ) : (
          <>
            {prefilled ? <FieldNote>{copy.t('prefillFromContact')}</FieldNote> : null}
            <Block title={copy.t('tutorPersonalTitle')} hint={copy.t('tutorPersonalHint')}>
              <Row>
                <Field name="paternal_surname" />
                <Field name="maternal_surname" />
              </Row>
              <Field name="given_names" />
              <Field name="marital_status" />
              <Field name="is_legal_guardian" />
            </Block>
            <Block title={copy.t('tutorBirthTitle')} hint={copy.t('tutorBirthHint')}>
              <Field name="curp" />
              <Row>
                <Field name="dob" />
                <Field name="sex" />
              </Row>
              <Row>
                <Field name="birth_country" />
                <Field name="birth_state" />
              </Row>
            </Block>
            <Block title={copy.t('tutorWorkTitle')} hint={copy.t('tutorWorkHint')}>
              <Field name="education_level" />
              <Field name="occupation" />
              <Field name="occupation_other" />
            </Block>
            <Block title={copy.t('tutorContactTitle')} hint={copy.t('tutorContactHint')}>
              <Row>
                <Field name="mobile" />
                <Field name="email" />
              </Row>
              <Row>
                <Field name="office_phone" />
                <Field name="office_ext" />
              </Row>
              <RestFields placed={PLACED} />
            </Block>
          </>
        )}
      </Blocks>
      <ConfirmDialog
        open={confirming}
        title={copy.t('naConfirmTitle')}
        message={copy.t('naConfirmText')}
        confirmLabel={copy.t('naConfirm')}
        onClose={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); form.setMany(cleared); }}
      />
    </FichaFormProvider>
  );
}
