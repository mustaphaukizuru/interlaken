"""Publish the school's institutional video.

``SiteSettings.video_url`` is admin-editable and empty by default, which hides
the "Conócenos en video" section. The school has one published video, so seed it
here instead of asking someone to paste a URL into Ajustes after every fresh
deploy. Only fills a blank field — an admin who changes or clears it keeps that
choice, and re-running the migration never overwrites their edit.
"""
from django.db import migrations

VIDEO_URL = 'https://youtu.be/z271WfIaPSE'


def seed_video(apps, schema_editor):
    SiteSettings = apps.get_model('content', 'SiteSettings')
    SiteSettings.objects.filter(video_url='').update(video_url=VIDEO_URL)


def unseed_video(apps, schema_editor):
    SiteSettings = apps.get_model('content', 'SiteSettings')
    SiteSettings.objects.filter(video_url=VIDEO_URL).update(video_url='')


class Migration(migrations.Migration):
    dependencies = [('content', '0023_admissions_pipeline')]
    operations = [migrations.RunPython(seed_video, unseed_video)]
