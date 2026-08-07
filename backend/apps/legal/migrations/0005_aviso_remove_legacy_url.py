# Removes the legacy PHP page URL (https://interlaken.com.mx/11aviso.php) from
# the official privacy-notice body. The old page no longer exists on the React
# site; the sentence now refers to the school website generically, which keeps
# the LFPDPPP notice accurate without pointing at a dead link.
from django.db import migrations

OLD = ('Por medio de la pagina de\ninternet https://interlaken.com.mx/11aviso.php '
       'y por medio escrito a cada uno\nde los usuarios.')
NEW = ('Por medio de nuestra página de internet y por medio escrito a cada uno '
       'de los usuarios.')

# Fallback: match the URL alone in case whitespace/line-wrapping differs.
URL = 'https://interlaken.com.mx/11aviso.php'


def strip_legacy_url(apps, schema_editor):
    PrivacyNoticeVersion = apps.get_model('legal', 'PrivacyNoticeVersion')
    for notice in PrivacyNoticeVersion.objects.all():
        body = notice.body
        if URL not in body:
            continue
        if OLD in body:
            body = body.replace(OLD, NEW)
        else:
            # URL present but wrapped differently — drop the URL token itself.
            body = body.replace(f'internet {URL} ', 'internet ')
            body = body.replace(URL, '').replace('  ', ' ')
        notice.body = body
        notice.save(update_fields=['body'])


class Migration(migrations.Migration):
    dependencies = [
        ('legal', '0004_aviso_texto_oficial'),
    ]

    operations = [
        migrations.RunPython(strip_legacy_url, migrations.RunPython.noop),
    ]
