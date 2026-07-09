# Data migration: siembra los costos por sección con las cifras publicadas
# por el colegio en su sitio anterior (ciclo 2024-2025) como VALORES INICIALES
# editables — el colegio los actualiza en el admin para el ciclo vigente.
from django.db import migrations

SEED = [
    # (section, inscripcion, colegiatura, order)  — inscripcion None = SIN COSTO
    ('Sección Maternal',        None,      3550.00, 1),
    ('1° a 3° de Preescolar',   6800.00,   4550.00, 2),
    ('Primaria',                8800.00,   6000.00, 3),
    ('Secundaria',              9600.00,   6550.00, 4),
]


def seed(apps, schema_editor):
    TuitionCost = apps.get_model('content', 'TuitionCost')
    if TuitionCost.objects.exists():
        return
    for section, inscripcion, colegiatura, order in SEED:
        TuitionCost.objects.create(
            section=section, inscripcion=inscripcion,
            colegiatura=colegiatura, order=order, is_active=True,
        )


def unseed(apps, schema_editor):
    TuitionCost = apps.get_model('content', 'TuitionCost')
    TuitionCost.objects.filter(
        section__in=[row[0] for row in SEED]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('content', '0005_tuitioncost'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
