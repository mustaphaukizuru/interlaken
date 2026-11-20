"""PrivacyNoticeVersion.published_at: when a version went live.

The console «Aviso de privacidad» (legal/notices.py) needs to tell a draft
apart from a version that was public and was later retired: both are
inactive, and a retired version that nobody accepted has no consent rows
either, yet its text was shown on the site and must stay frozen. Every
version that exists before this migration was published through a data
migration or Django admin, so those count as published unless they were
created after the version in force and never activated (an unpublished
draft someone left in Django admin).
"""
from django.db import migrations, models


def mark_published(apps, schema_editor):
    PrivacyNoticeVersion = apps.get_model('legal', 'PrivacyNoticeVersion')
    ConsentRecord = apps.get_model('legal', 'ConsentRecord')
    Registration = apps.get_model('admissions', 'Registration')
    active = PrivacyNoticeVersion.objects.filter(is_active=True).order_by('-created_at').first()
    referenced = set(ConsentRecord.objects.values_list('notice_version_id', flat=True)) | set(
        Registration.objects.exclude(privacy_notice_version=None).values_list('privacy_notice_version_id', flat=True))
    for notice in PrivacyNoticeVersion.objects.all():
        was_live = (notice.is_active or notice.pk in referenced
                    or (active is not None and notice.created_at <= active.created_at))
        if was_live:
            notice.published_at = notice.created_at
            notice.save(update_fields=['published_at'])


class Migration(migrations.Migration):

    dependencies = [
        ('legal', '0007_data_ops_indexes'),
        ('admissions', '0004_registration_consent_medical_data_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='privacynoticeversion',
            name='published_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Publicada'),
        ),
        migrations.RunPython(mark_published, migrations.RunPython.noop),
    ]
