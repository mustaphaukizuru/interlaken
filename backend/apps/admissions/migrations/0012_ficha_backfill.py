"""Ficha de inscripción (Fase 1): backfill the new fields of existing records.

For every existing Registration:

* ``child_given_names`` = ``child_first_name``; ``child_last_name`` split on
  its first space into ``child_paternal_surname`` / ``child_maternal_surname``;
* the step-0 contact (``contact_*``) = parent 1 (the relationship comes from
  the linked pre-registro when there is one);
* the emergency contact name split into given names / surnames;
* one ``RegistrationGuardian`` per legacy parent (best-effort name split:
  the last two words are the surnames). The block (padre/madre) follows the
  pre-registro's relationship when it says so; otherwise parent 1 → «padre»
  and parent 2 → «madre», the Excel order. ``sex`` stays blank so the family
  (or the office) confirms the block before the ficha can be sent.

``ficha_version`` stays 1: these records keep the old submit rules until
someone saves them through the ficha.

Reverse: deletes the guardian rows (0011's reverse drops the columns). Rows
created by the ficha itself may lack a birth date (the public start comes
before it); reversing past 0011 needs ``child_dob`` NOT NULL again, so the
reverse sets those to 1900-01-01, an obviously placeholder date.

Self-contained on purpose (historical models, local helpers): app code may
change after this migration ships.
"""

from datetime import date

from django.db import migrations

PLACEHOLDER_DOB = date(1900, 1, 1)


def _split_full_name(name):
    words = (name or '').split()
    if not words:
        return '', '', ''
    if len(words) == 1:
        return words[0], '', ''
    if len(words) == 2:
        return words[0], words[1], ''
    return ' '.join(words[:-2]), words[-2], words[-1]


def _role_hint(relationship):
    text = (relationship or '').strip().lower()
    if text in ('madre', 'mamá', 'mama'):
        return 'madre'
    if text in ('padre', 'papá', 'papa'):
        return 'padre'
    return None


def forwards(apps, schema_editor):
    Registration = apps.get_model('admissions', 'Registration')
    Guardian = apps.get_model('admissions', 'RegistrationGuardian')
    for reg in Registration.objects.select_related('pre_registration').iterator():
        fields = []
        if not reg.child_given_names and reg.child_first_name:
            reg.child_given_names = reg.child_first_name[:100]
            fields.append('child_given_names')
        if not reg.child_paternal_surname and not reg.child_maternal_surname and reg.child_last_name:
            paternal, _, maternal = reg.child_last_name.strip().partition(' ')
            reg.child_paternal_surname = paternal[:100]
            reg.child_maternal_surname = maternal.strip()[:100]
            fields += ['child_paternal_surname', 'child_maternal_surname']
        relationship = reg.pre_registration.relationship if reg.pre_registration_id else ''
        if not reg.contact_email and reg.parent1_email:
            reg.contact_name = reg.parent1_name[:200]
            reg.contact_email = reg.parent1_email
            reg.contact_phone = reg.parent1_phone[:20]
            reg.contact_relationship = (relationship or '')[:50]
            fields += ['contact_name', 'contact_email', 'contact_phone', 'contact_relationship']
        if reg.emergency_name and not (reg.emergency_given_names or reg.emergency_surnames):
            given, paternal, maternal = _split_full_name(reg.emergency_name)
            reg.emergency_given_names = given[:100]
            reg.emergency_surnames = ' '.join(p for p in (paternal, maternal) if p)[:150]
            fields += ['emergency_given_names', 'emergency_surnames']
        if fields:
            reg.save(update_fields=fields)

        if Guardian.objects.filter(registration_id=reg.pk).exists():
            continue
        first_role = _role_hint(relationship) or 'padre'
        second_role = 'madre' if first_role == 'padre' else 'padre'
        legacy = (
            (first_role, reg.parent1_name, reg.parent1_email, reg.parent1_phone, reg.parent1_occupation),
            (second_role, reg.parent2_name, reg.parent2_email, reg.parent2_phone, ''),
        )
        for role, name, email, phone, occupation in legacy:
            if not ((name or '').strip() or (email or '').strip()):
                continue
            given, paternal, maternal = _split_full_name(name)
            Guardian.objects.create(
                registration_id=reg.pk, role=role,
                given_names=given[:100], paternal_surname=paternal[:100],
                maternal_surname=maternal[:100],
                email=(email or '').strip(), mobile=(phone or '').strip()[:20],
                occupation='otro' if occupation else '',
                occupation_other=(occupation or '')[:100],
            )


def backwards(apps, schema_editor):
    Registration = apps.get_model('admissions', 'Registration')
    PreRegistration = apps.get_model('admissions', 'PreRegistration')
    Guardian = apps.get_model('admissions', 'RegistrationGuardian')
    # The backfilled columns themselves go away with 0011's reverse.
    Guardian.objects.all().delete()
    Registration.objects.filter(child_dob__isnull=True).update(child_dob=PLACEHOLDER_DOB)
    PreRegistration.objects.filter(child_dob__isnull=True).update(child_dob=PLACEHOLDER_DOB)


class Migration(migrations.Migration):

    dependencies = [
        ('admissions', '0011_ficha_fields_and_guardians'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
