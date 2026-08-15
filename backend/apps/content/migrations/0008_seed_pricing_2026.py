# Data migration: siembra el catálogo de precios del ciclo 2026-2027 con las
# cifras publicadas por el colegio en su flyer oficial "Inscripciones Ciclo
# Escolar 2026-2027" (agosto 2026) como VALORES INICIALES editables en el admin.
# También actualiza las colegiaturas sembradas en 0006 (eran del ciclo
# 2024-2025) a las cifras del flyer.
from django.db import migrations

ENROLLMENT = [
    # (section, modality, gastos_administrativos, cuota, order)
    ('Preescolar', 'nuevo_ingreso', 2500.00, 6800.00, 1),
    ('Primaria',   'nuevo_ingreso', 2500.00, 8800.00, 2),
    ('Secundaria', 'nuevo_ingreso', 2500.00, 9600.00, 3),
    ('Preescolar', 'reinscripcion', 2000.00, 5760.00, 1),
    ('Primaria',   'reinscripcion', 2000.00, 7200.00, 2),
    ('Secundaria', 'reinscripcion', 2000.00, 7980.00, 3),
]

# Colegiaturas 2026 (11 mensualidades, agosto a junio). La llave es una
# subcadena del nombre sembrado en 0006 para tolerar ediciones menores.
TUITION_2026 = [
    ('Maternal',   4190.00, None),      # inscripción sigue "SIN COSTO"
    ('Preescolar', 4920.00, 6800.00),
    ('Primaria',   6450.00, 8800.00),
    ('Secundaria', 6990.00, 9600.00),
]

FIXED = [
    ('Seguro accidentes', 500.00, 1),
    ('Seguro orfandad',   700.00, 2),
    ('Credenciales',      350.00, 3),
]

EXTRACURRICULAR = [
    ('Karate',         'Preescolar y Primaria',      4200.00, 1),
    ('Dance Kids',     'Preescolar',                 4200.00, 2),
    ('K-Pop',          'Primaria',                   4200.00, 3),
    ('Basquet',        'Preescolar y Primaria',      4200.00, 4),
    ('Teatro musical', '4° de Primaria a Secundaria', 7100.00, 5),
]

DAYCARE = [
    # (schedule, service, daily, monthly, monthly_note, order)
    ('Entrada 7:10',    'Preescolar matutina',                70.00,  500.00,  'Matutina', 1),
    ('De 13:30 a 14:30', 'Preescolar vespertina sin alimentos', 70.00,  700.00,  'Matutina y vespertina', 2),
    ('Hasta 15:50',     'Comida y estancia',                  150.00, 2670.00, '', 3),
    ('Hasta 16:50',     'Comida y estancia',                  155.00, 2760.00, '', 4),
    ('Hasta 17:30',     'Comida y estancia',                  165.00, 2945.00, '', 5),
    ('Después de 18:00', 'Multa de estancia',                  300.00, None,
     'Se cancela el servicio definitivamente', 6),
]

POLICIES = [
    ('La cuota de inscripción y reinscripción se divide en 4 parcialidades, '
     'de enero a abril.', 1),
    ('Los gastos administrativos no tienen devolución. La cuota de inscripción '
     'y reinscripción se devuelve al 100% antes del 1 de junio de 2026; '
     'después de esa fecha no hay devoluciones.', 2),
    ('Las colegiaturas se pagan en 11 mensualidades, de agosto a junio. A '
     'partir del día 17 del mes se aplica un recargo del 5% mensual sobre el '
     'saldo insoluto.', 3),
    ('Las becas, descuentos y promociones no son acumulables con ningún otro '
     'tipo de descuento.', 4),
    ('La contratación de seguros y credenciales es obligatoria.', 5),
    ('Las clases extraescolares se definen en agosto y su anualidad se paga '
     'en 10 parcialidades, de septiembre a junio.', 6),
]


def seed(apps, schema_editor):
    EnrollmentFee = apps.get_model('content', 'EnrollmentFee')
    FixedConcept = apps.get_model('content', 'FixedConcept')
    Extracurricular = apps.get_model('content', 'ExtracurricularActivity')
    DaycareRate = apps.get_model('content', 'DaycareRate')
    PricingPolicy = apps.get_model('content', 'PricingPolicy')
    TuitionCost = apps.get_model('content', 'TuitionCost')

    for section, modality, gastos, cuota, order in ENROLLMENT:
        EnrollmentFee.objects.update_or_create(
            section=section, modality=modality,
            defaults={'gastos_administrativos': gastos, 'cuota': cuota,
                      'order': order, 'is_active': True})

    for match, colegiatura, inscripcion in TUITION_2026:
        TuitionCost.objects.filter(section__icontains=match).update(
            colegiatura=colegiatura, inscripcion=inscripcion)

    if not FixedConcept.objects.exists():
        for name, cost, order in FIXED:
            FixedConcept.objects.create(name=name, cost=cost, mandatory=True, order=order)

    if not Extracurricular.objects.exists():
        for name, levels, cost, order in EXTRACURRICULAR:
            Extracurricular.objects.create(
                name=name, levels=levels, annual_cost=cost, order=order)

    if not DaycareRate.objects.exists():
        for schedule, service, daily, monthly, note, order in DAYCARE:
            DaycareRate.objects.create(
                schedule=schedule, service=service, daily_cost=daily,
                monthly_cost=monthly, monthly_note=note, order=order)

    if not PricingPolicy.objects.exists():
        for text, order in POLICIES:
            PricingPolicy.objects.create(text=text, order=order)


def unseed(apps, schema_editor):
    for model in ('EnrollmentFee', 'FixedConcept', 'ExtracurricularActivity',
                  'DaycareRate', 'PricingPolicy'):
        apps.get_model('content', model).objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ('content', '0007_daycarerate_extracurricularactivity_fixedconcept_and_more'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
