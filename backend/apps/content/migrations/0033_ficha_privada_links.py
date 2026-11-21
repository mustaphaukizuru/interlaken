"""No public links to the ficha de inscripción (2026-11-21).

The ficha is private now: the school sends each family its personal link once
the child is admitted (exam «Aceptado»). The designed sections' defaults
(frontend/src/cms/sections/*.tsx, components/public/PricingSections.tsx) no
longer link to /pre-registro or ask families to fill the ficha themselves:
their calls to action are «Agendar visita» and «Solicitar informes»
(WhatsApp). This migration brings the CMS pages that still hold the OLD
defaults up to the NEW ones.

Rules (``RULES``): a prop changes ONLY when it still has one of the old
default values (every version the design shipped). A button counts as the
old one when it goes to /pre-registro with one of the old default labels.
Some props follow the button of their section (the secondary «Agendar visita»
becomes «Solicitar informes» so the section does not show two visit buttons):
they change only when that section's ficha button changed.

Per page:
* not published (draft only): the draft is updated;
* published, draft equal to the published version: the draft is updated and
  published as a new version (author: none, audited), so the live page
  changes; production's «costos» page is this case;
* published with unpublished edits (draft differs): left alone, reported;
* anything still linking to /pre-registro afterwards (a button the school
  edited, a generic block) is left alone and reported.

The report is printed while migrating. Backwards is a no-op on purpose:
putting public links back to a private page would only break it, and every
earlier published version stays in the page history («Versiones»).

The NEW values mirror frontend/src/cms/sections/kit.tsx (VISIT_CTA,
INFORMES_CTA) and the section defaults; keep them in step.
"""
from django.core.cache import cache
from django.db import migrations
from django.db.models import Max
from django.utils import timezone

FICHA_PATH = '/pre-registro'
# Every label the designs ever gave a button to the ficha (or the old pre-registro).
OLD_FICHA_LABELS = {
    'Llene la ficha de inscripción',
    'Llenar la ficha de inscripción',
    'Inicie su pre-registro',
    'Iniciar pre-registro',
    'Ir al pre-registro',
    'Inicie aquí',
    '¿Aún no llena la ficha de inscripción? Empiece aquí →',
    '¿Aún no se pre-registra? Inicie su pre-registro aquí →',
}

VISIT = {'label': 'Agendar visita', 'href': '/agendar-visita'}
INFORMES = {
    'label': 'Solicitar informes',
    'href': 'https://wa.me/{{whatsapp}}?text=Hola%2C%20me%20gustar%C3%ADa%20recibir%20informes%20de%20admisi%C3%B3n%20del%20Colegio%20Interlaken.',
}
ADMISSIONS = {'label': 'Conozca el proceso de admisión', 'href': '/admisiones'}
OLD_VISIT_BUTTONS = (
    {'label': 'Agendar visita', 'href': '/agendar-visita'},
    {'label': 'Agendar una visita', 'href': '/agendar-visita'},
)

CTA_TEXT = 'Agende una visita para conocer el colegio o escríbanos para recibir informes. Le acompañamos en cada paso de la admisión.'
OLD_CTA_TEXTS = (
    'Agende una visita o inicie su pre-registro en línea en solo unos minutos.',
    'Agende una visita o llene en línea la ficha de inscripción: unos 15 minutos, y puede continuar después.',
)

STEP3_OLD = {
    'title': 'Documentación',
    'text': 'Consulte la lista de documentos requeridos, con enlaces a trámites oficiales.',
    'link': {'label': 'Ver documentación', 'href': '/admisiones/documentacion'},
}
STEP3_NEW = {
    'icon': 'FileText', 'step': '03', 'key': 'examen', 'title': 'Examen de valoración',
    'text': 'Después de la visita agendamos el examen de valoración de su hijo/a. Consulte los documentos que se piden.',
    'color': 'var(--pink)', 'link': {'label': 'Ver documentación', 'href': '/admisiones/documentacion'},
}
STEP4_OLD_TEXTS = (
    'Complete el pre-registro en línea en menos de 5 minutos y asegure su lugar.',
    'Llene en línea la ficha de inscripción (unos 15 minutos; puede guardarla y continuar después) y asegure su lugar.',
)
STEP4_NEW = {
    'icon': 'ClipboardList', 'step': '04', 'key': 'inscripcion', 'title': 'Inscripción',
    'text': 'Si su hijo/a es admitido, le enviamos por correo o WhatsApp su ficha de inscripción personal para llenarla en línea y asegurar su lugar.',
    'color': 'var(--green)', 'link': {'label': 'Ver costos', 'href': '/admisiones/costos'},
}

FAQ_FICHA = {
    'q': '¿Cuándo se llena la ficha de inscripción?',
    'a': 'Cuando su hijo/a es admitido después del examen de valoración, el colegio le envía por correo o WhatsApp un enlace personal a su ficha de inscripción. Se llena en línea en unos 15 minutos y puede guardarla y continuar después.',
}
FAQ_PROCESS = {
    'q': '¿Cómo es el proceso de admisión?',
    'a': 'Informes, visita guiada y examen de valoración. Si su hijo/a es admitido, le enviamos su ficha de inscripción, entrega los documentos y confirma su lugar. Un asesor le guía en cada paso.',
}
# (question, answer) of an old default → the new question and answer.
OLD_FAQ = {
    ('¿Cuánto tarda el pre-registro en línea?',
     'Menos de 5 minutos. Recibirá confirmación inmediata y un asesor le contactará en un plazo de 2 días hábiles.'):
        FAQ_FICHA,
    ('¿Cuánto tarda la ficha de inscripción en línea?',
     'Unos 15 minutos. Se guarda en cada paso, así que puede dejarla y continuar después con el enlace que le '
     'enviamos a su correo. Un asesor le contactará en un plazo de 2 días hábiles.'):
        FAQ_FICHA,
    ('¿Cómo es el proceso de admisión?',
     'Pre-registro en línea, entrega de documentos, examen de valoración y confirmación de lugar. Un asesor le '
     'guía en cada paso.'):
        FAQ_PROCESS,
    ('¿Cómo es el proceso de admisión?',
     'Ficha de inscripción en línea, entrega de documentos, examen de valoración y confirmación de lugar. Un '
     'asesor le guía en cada paso.'):
        FAQ_PROCESS,
}

VISIT_STEPS_OLD = (
    ['Complete su pre-registro con los datos de su hijo/a', 'Elija fecha y horario disponibles aquí mismo',
     'Reciba la confirmación de su visita por correo'],
    ['Llene la ficha de inscripción con los datos de su hijo/a', 'Elija fecha y horario disponibles aquí mismo',
     'Reciba la confirmación de su visita por correo'],
)
VISIT_STEPS_NEW = [
    {'text': 'Elija fecha y horario disponibles aquí mismo'},
    {'text': 'Reciba la confirmación de su visita por correo'},
    {'text': 'Después de la visita agendamos el examen de valoración de su hijo/a'},
]


# ── matchers ─────────────────────────────────────────────────────────────
def is_old_ficha_button(value) -> bool:
    return (
        isinstance(value, dict)
        and str(value.get('href') or '').strip() == FICHA_PATH
        and str(value.get('label') or '').strip() in OLD_FICHA_LABELS
    )


def one_of(*values):
    return lambda value: value in values


def button(new):
    """A ficha button with an old label → ``new``."""
    return (is_old_ficha_button, lambda _old: dict(new))


def text(old_values, new):
    return (one_of(*old_values), lambda _old: new)


def visit_steps(value) -> bool:
    if not isinstance(value, list) or not all(isinstance(i, dict) for i in value):
        return False
    return [i.get('text') for i in value] in [list(v) for v in VISIT_STEPS_OLD]


def admission_steps(follow: bool):
    """Item 04 (the ficha) of «Proceso de admisión»; with ``follow``, item 03 next to it."""
    def matches(item) -> bool:
        if not isinstance(item, dict):
            return False
        if follow:
            return all(item.get(k) == v for k, v in STEP3_OLD.items())
        return is_old_ficha_button(item.get('link')) and item.get('text') in STEP4_OLD_TEXTS
    return matches


def faq_item(item) -> bool:
    return isinstance(item, dict) and (item.get('q'), item.get('a')) in OLD_FAQ


# Per section type: (prop, matcher, new value, kind). BUTTON: the ficha
# button itself; TEXT: an old default text; FOLLOW: changes only when a
# BUTTON rule changed the same section (the secondary «Agendar visita» next
# to it, the title over it). Item rules (``items[]``) apply element by element.
BUTTON, TEXT, FOLLOW = 'button', 'text', 'follow'

RULES = {
    'home.hero': [('primary', *button(VISIT), BUTTON)],
    'home.cta': [
        ('primary', *button(VISIT), BUTTON),
        ('text', *text(OLD_CTA_TEXTS, CTA_TEXT), TEXT),
        ('secondary', one_of(*OLD_VISIT_BUTTONS), lambda _o: dict(INFORMES), FOLLOW),
    ],
    'about.cta': [
        ('primary', *button(VISIT), BUTTON),
        ('text', *text(OLD_CTA_TEXTS, CTA_TEXT), TEXT),
        ('secondary', one_of(*OLD_VISIT_BUTTONS), lambda _o: dict(INFORMES), FOLLOW),
    ],
    'admisiones.docs_cta': [
        ('primary', *button(VISIT), BUTTON),
        ('text', *text((
            'El pre-registro toma menos de 5 minutos. Recibirá confirmación inmediata y le contactaremos para '
            'coordinar los siguientes pasos.',
            'La ficha de inscripción toma unos 15 minutos y puede guardarla y continuar después. Le contactaremos '
            'para coordinar los siguientes pasos.',
        ), 'El primer paso es conocernos: agende una visita guiada o escríbanos para recibir informes. Después del examen de valoración, si su hijo/a es admitido, le enviamos su ficha de inscripción.'), TEXT),
        ('secondary', one_of(*OLD_VISIT_BUTTONS), lambda _o: dict(INFORMES), FOLLOW),
    ],
    'admisiones.steps': [
        ('items[]', admission_steps(follow=False), lambda old: {**old, **STEP4_NEW}, BUTTON),
        ('items[]', admission_steps(follow=True), lambda old: {**old, **STEP3_NEW}, FOLLOW),
    ],
    'admisiones.faq': [
        ('items[]', faq_item, lambda old: {**old, **OLD_FAQ[(old.get('q'), old.get('a'))]}, TEXT),
    ],
    'documentacion.list': [
        ('cta', *button(VISIT), BUTTON),
        ('ctaText', *text((
            'Inicie su pre-registro y coordine la entrega de documentos con nuestro equipo de admisiones.',
            'Llene la ficha de inscripción y coordine la entrega de documentos con nuestro equipo de admisiones.',
        ), 'Agende una visita guiada. Después del examen de valoración, si su hijo/a es admitido, le enviamos su ficha de inscripción y coordinamos con usted la entrega de documentos.'), TEXT),
        ('ctaTitle', one_of('¿Documentos listos?'), lambda _o: '¿Listo para conocernos?', FOLLOW),
    ],
    'nivel.hero': [
        ('primary', *button(VISIT), BUTTON),
        ('secondary', one_of(*OLD_VISIT_BUTTONS), lambda _o: dict(INFORMES), FOLLOW),
    ],
    'visita.hero': [
        ('subtitle', *text((
            'Un recorrido personalizado para su familia: complete su pre-registro, elija la fecha que le convenga '
            'y confirme su cita.',
            'Un recorrido personalizado para su familia: elija la fecha que le convenga, confirme su cita y llene '
            'la ficha de inscripción cuando guste.',
        ), 'Un recorrido personalizado para su familia: elija la fecha que le convenga y confirme su cita. Es el primer paso del proceso de admisión.'), TEXT),
    ],
    'visita.steps': [
        ('items', visit_steps, lambda _o: [dict(i) for i in VISIT_STEPS_NEW], TEXT),
        ('link', is_old_ficha_button,
         lambda _o: {'label': 'Conozca el proceso de admisión →', 'href': '/admisiones'}, BUTTON),
    ],
    'acceso.screen': [
        ('signupLink', *button(ADMISSIONS), BUTTON),
        ('signupText', one_of('¿No tiene cuenta?'), lambda _o: '¿No tiene cuenta? Su cuenta se crea al inscribirse.',
         FOLLOW),
    ],
    'costos.prices': [
        ('ctaPrimary', *button(VISIT), BUTTON),
        ('ctaText', *text((
            'Inicie su pre-registro para el ciclo {{ciclo}} — toma menos de 5 minutos y un asesor le contactará.',
            'Llene la ficha de inscripción para el ciclo {{ciclo}}: toma unos 15 minutos, puede continuar después y '
            'un asesor le contactará.',
        ), 'Agende una visita para el ciclo {{ciclo}} o escríbanos para recibir informes. Después del examen de valoración, si su hijo/a es admitido, le enviamos su ficha de inscripción.'), TEXT),
        ('ctaSecondary', one_of(*OLD_VISIT_BUTTONS), lambda _o: dict(INFORMES), FOLLOW),
    ],
    'preregistro.hero': [
        ('subtitle', *text((
            'Menos de 5 minutos. Recibirá confirmación inmediata y un asesor le contactará en 2 días hábiles.',
            'Unos 15 minutos, en pasos que se guardan al continuar. Puede dejarla y seguir después con el enlace '
            'que le enviamos a su correo.',
        ), 'Es el último paso de la admisión: el colegio envía a cada familia admitida su enlace personal para llenarla en línea.'), TEXT),
    ],
}


def apply_rule(props, prop, matches, new) -> bool:
    if prop.endswith('[]'):
        key = prop[:-2]
        items = props.get(key)
        if not isinstance(items, list):
            return False
        out = [new(i) if matches(i) else i for i in items]
        if out == items:
            return False
        props[key] = out
        return True
    if prop not in props or not matches(props[prop]):
        return False
    value = new(props[prop])
    if value == props[prop]:
        return False
    props[prop] = value
    return True


def update_block(block):
    """``(new block, changed)``: the block with its old defaults replaced."""
    if not isinstance(block, dict):
        return block, False
    rules = RULES.get(str(block.get('type') or ''))
    props = block.get('props')
    if not rules or not isinstance(props, dict):
        return block, False
    props = dict(props)
    button_changed = text_changed = False
    for prop, matches, new, kind in rules:
        if kind != FOLLOW and apply_rule(props, prop, matches, new):
            button_changed = button_changed or kind == BUTTON
            text_changed = text_changed or kind == TEXT
    if button_changed:
        for prop, matches, new, kind in rules:
            if kind == FOLLOW:
                apply_rule(props, prop, matches, new)
    if not (button_changed or text_changed):
        return block, False
    return {**block, 'props': props}, True


def update_blocks(blocks):
    if not isinstance(blocks, list):
        return blocks, False
    out, changed = [], False
    for block in blocks:
        new, did = update_block(block)
        out.append(new)
        changed = changed or did
    return out, changed


def ficha_links(value, path=''):
    """Every place in ``value`` (a block list) that still links to the ficha."""
    found = []
    if isinstance(value, dict):
        for k, v in value.items():
            at = f'{path}.{k}' if path else str(k)
            if k in ('href', 'to') and isinstance(v, str) and v.strip().split('?')[0].rstrip('/') == FICHA_PATH:
                found.append(path or at)
            elif k == 'form' and v == 'pre-registro':
                found.append(at)
            elif isinstance(v, str) and 'href="/pre-registro' in v:
                found.append(at)
            else:
                found.extend(ficha_links(v, at))
    elif isinstance(value, list):
        for n, v in enumerate(value):
            at = f'{path}.{n}' if path else str(n)
            if isinstance(v, dict) and path == '' and v.get('type'):
                at = f'{n + 1} ({v.get("type")})'
            found.extend(ficha_links(v, at))
    return found


def publish(apps, page):
    """Page.publish(None), with the historical models (a migration cannot call model methods)."""
    PageVersion = apps.get_model('content', 'PageVersion')
    AuditLog = apps.get_model('core', 'AuditLog')
    number = (PageVersion.objects.filter(page=page).aggregate(m=Max('number'))['m'] or 0) + 1
    version = PageVersion.objects.create(page=page, number=number, blocks=page.draft_blocks, seo=page.seo, author=None)
    page.published_version = version
    page.status = 'published'
    page.published_at = timezone.now()
    page.review_requested_at = None
    page.review_requested_by = None
    page.review_note = ''
    page.publish_at = None
    page.save(update_fields=['published_version', 'status', 'published_at', 'review_requested_at',
                             'review_requested_by', 'review_note', 'publish_at'])
    AuditLog.objects.create(
        actor=None, actor_label='Sistema (migración)', action='update', object_type='content.page',
        object_id=str(page.pk), changes={'published_version': number, 'reason': 'ficha de inscripción privada'},
        context='cms.publish',
    )
    return number


def clear_caches(slug):
    # Same keys as apps.content.pages (PAGE_CACHE, HEAD_CACHE) and navigation.SITEMAP_CACHE_KEY.
    cache.delete(f'cms:page:{slug}')
    cache.delete(f'cms:head:{slug}')
    cache.delete('cms:sitemap')


def forwards(apps, schema_editor):
    Page = apps.get_model('content', 'Page')
    report = []
    for page in Page.objects.select_related('published_version').order_by('slug'):
        draft = page.draft_blocks or []
        live = page.published_version.blocks if page.status == 'published' and page.published_version_id else None
        in_sync = live is not None and draft == live
        new_draft, changed = update_blocks(draft)
        if changed and live is not None and not in_sync:
            report.append(f'«{page.slug}»: tiene cambios sin publicar; no se modificó. Revise sus enlaces a la ficha '
                          f'en Contenido: {", ".join(ficha_links(draft) + ficha_links(live)) or "textos"}.')
            continue
        if changed:
            page.draft_blocks = new_draft
            page.draft_revision = (page.draft_revision or 0) + 1
            page.draft_updated_by = None
            page.draft_updated_at = timezone.now()
            page.save(update_fields=['draft_blocks', 'draft_revision', 'draft_updated_by', 'draft_updated_at'])
            if in_sync:
                number = publish(apps, page)
                report.append(f'«{page.slug}»: textos y botones de la ficha actualizados y publicados (versión {number}).')
            else:
                report.append(f'«{page.slug}»: borrador actualizado (la página no está publicada).')
            clear_caches(page.slug)
        left = ficha_links(page.draft_blocks or [])
        if live is not None and not in_sync and not changed:
            left += [f'{p} (versión publicada)' for p in ficha_links(live)]
        if left:
            report.append(f'«{page.slug}»: todavía enlaza a /pre-registro (editado por el colegio, no se tocó): '
                          f'{", ".join(dict.fromkeys(left))}.')
    for line in report:
        print(f'  [ficha privada] {line}')


def backwards(apps, schema_editor):
    """No-op on purpose (see the module docstring)."""


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0032_ficha_privada'),
        ('core', '0006_audit_search_unaccent_trgm'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
