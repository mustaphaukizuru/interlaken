"""
content/legacy_seed.py: recognise the page drafts the old ``seed_cms`` wrote.

From 2026-08-22 (9c7b059, P3-2) until the designed sections replaced it
(77371a7, 2026-10-20), ``python manage.py seed_cms`` created nine draft pages
made of generic blocks (plain hero, feature grid, gallery...). The site never
showed them, but publishing one replaces the designed page with those generic
blocks. This module reproduces every variant the command ever wrote, taken from
``git log -p backend/apps/content/management/commands/seed_cms.py``:

* 9c7b059  inicio, nosotros, galeria, contacto; nosotros timeline empty;
           inicio buttons to /pre-registro.
* 6e2d399  + admisiones, costos, modelo-educativo, plataformas, documentacion.
* 7a404c4  nosotros timeline with two items.
* 58e8e11  inicio buttons to /agendar-visita.

Image props held media-library ids of the photos the command imported from
frontend/public/assets (``pic('facade.webp')``, or None when that file was not
there), so ids differ per database: a slot matches no image, a missing asset or
an asset with that file name. ``matches_seed`` compares structurally: block ids,
``hidden: false`` and empty values (None, '', [], {}) are ignored, everything
else must be identical, so any edit made in the old editor counts as an edit.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

# seed_cms ASSET_ALTS (unchanged in every version).
ASSET_ALTS = {
    'facade.webp': 'Fachada del Colegio Interlaken',
    'facade-sign.webp': 'Letrero del Colegio Interlaken en la entrada',
    'classroom.webp': 'Alumnos en clase de inglés',
    'court-primaria.webp': 'Cancha de primaria durante el recreo',
    'court-wide.webp': 'Cancha deportiva del colegio',
    'campus-mural.webp': 'Mural del campus',
    'hopscotch.webp': 'Niñas jugando avión en el patio',
    'primaria-gate.webp': 'Entrada de primaria',
    'secundaria.webp': 'Edificio de secundaria',
    'interlaken-image (1).webp': 'Comunidad Interlaken',
    'interlaken-image (2).webp': 'Actividades en el colegio',
    'interlaken-image (4).webp': 'Alumnos de Interlaken',
    'interlaken-image (15).webp': 'Convivencia escolar',
}
HOME_GALLERY = ('interlaken-image (1).webp', 'interlaken-image (2).webp', 'interlaken-image (4).webp', 'classroom.webp')


# ── pattern markers ─────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Img:
    """An image slot the seed filled with ``pic(name)``."""
    name: str


@dataclass(frozen=True)
class OneOf:
    """Seed versions differ here; any alternative matches."""
    options: tuple


@dataclass(frozen=True)
class Gallery:
    """``[{image, caption}]`` built from imported photos: ``names`` in that order, or every imported photo (None)."""
    names: tuple | None = None


def _b(type_: str, **props) -> tuple[str, dict]:
    return (type_, props)


TO_VISIT = OneOf(('/pre-registro', '/agendar-visita'))

SEED_PAGES: dict[str, dict] = {
    'inicio': {
        'title': 'Inicio',
        'seo': {'title': 'Colegio Interlaken · Preescolar, Primaria y Secundaria bilingüe',
                'description': 'Colegio bilingüe con incorporación SEP. Inglés diario desde preescolar, valores y comunidad.'},
        'blocks': [
            _b('hero', title='Educación bilingüe con valores',
               subtitle='Preescolar, Primaria y Secundaria con inglés todos los días, en una comunidad que conoce a cada familia por su nombre.',
               image=Img('facade.webp'), cta={'label': 'Agendar visita', 'href': TO_VISIT}),
            _b('stats', items=[{'value': '95%', 'label': 'Aprovechamiento'}, {'value': '3', 'label': 'Niveles educativos'},
                               {'value': 'SEP', 'label': 'Incorporación oficial'}, {'value': '100%', 'label': 'Inglés diario'}]),
            _b('levels_cards'),
            _b('feature_grid', title='Por qué Interlaken', items=[
                {'title': 'Inglés desde preescolar, todos los días', 'text': 'Modelo bilingüe con certificaciones internacionales.'},
                {'title': 'Formamos personas íntegras y felices', 'text': 'Comunidad y valores en cada etapa.'},
                {'title': 'Incorporación oficial SEP', 'text': 'Validez oficial en los tres niveles.'},
            ]),
            _b('gallery', images=Gallery(HOME_GALLERY)),
            _b('testimonials'),
            _b('calendar'),
            _b('cta_band', title='Conozca el colegio', text='Agende una visita individual o una clase abierta.',
               cta={'label': 'Agendar visita', 'href': TO_VISIT}),
        ],
    },
    'nosotros': {
        'title': 'Nosotros',
        'seo': {'title': 'Nosotros · Colegio Interlaken', 'description': 'Historia, misión y valores del Colegio Interlaken.'},
        'blocks': [
            _b('hero', title='Nosotros', subtitle='Una comunidad educativa con décadas de trayectoria.', image=Img('facade-sign.webp')),
            _b('rich_text', html='<h2>Misión</h2><p>Formar personas íntegras, bilingües y felices, capaces de transformar su entorno.</p>'
                                 '<h2>Visión</h2><p>Ser el colegio de referencia en formación bilingüe con valores en la región.</p>'),
            _b('timeline', items=OneOf(([], [{'year': '1990', 'title': 'Fundación', 'text': 'Nace el Colegio Interlaken con el nivel preescolar.'},
                                             {'year': 'Hoy', 'title': 'Tres niveles', 'text': 'Preescolar, Primaria y Secundaria con incorporación SEP.'}]))),
            _b('sep_incorporation'),
            _b('map_contact'),
        ],
    },
    'admisiones': {
        'title': 'Admisiones',
        'seo': {'title': 'Admisiones · Colegio Interlaken', 'description': 'Proceso de admisión en 4 pasos, preguntas frecuentes y pre-registro en línea.'},
        'blocks': [
            _b('hero', title='Admisiones', subtitle='Un proceso claro en cuatro pasos, con un asesor que le acompaña.',
               image=Img('classroom.webp'), cta={'label': 'Pre-registro en línea', 'href': '/pre-registro'}),
            _b('feature_grid', title='Cómo funciona', items=[
                {'title': '1. Pre-registro', 'text': 'Complete el pre-registro en línea en menos de 5 minutos y asegure su lugar.'},
                {'title': '2. Visita', 'text': 'Conozca las instalaciones y al equipo docente en un recorrido personalizado.'},
                {'title': '3. Documentos', 'text': 'Consulte la lista de documentos requeridos, con enlaces a trámites oficiales.'},
                {'title': '4. Asesoría', 'text': 'Escríbanos por WhatsApp y un asesor de admisiones resuelve sus dudas.'},
            ]),
            _b('open_school_events'),
            _b('faq', items=[
                {'q': '¿Qué niveles educativos ofrece Colegio Interlaken?', 'a': 'Ofrecemos preescolar, primaria y secundaria, con un modelo bilingüe (español–inglés) en cada nivel.'},
                {'q': '¿Cómo es el proceso de admisión?', 'a': 'Pre-registro en línea, entrega de documentos, examen de valoración y confirmación de lugar. Un asesor le guía en cada paso.'},
                {'q': '¿Cómo están estructurados los costos?', 'a': 'Las colegiaturas se pagan en 11 mensualidades, de agosto a junio. Consulte el desglose por sección en la página de Costos.'},
                {'q': '¿Ofrecen becas o descuentos?', 'a': 'Contamos con apoyos para hermanos y casos especiales. Escríbanos desde la sección de Contacto para conocer las opciones vigentes.'},
                {'q': '¿El colegio cuenta con incorporación oficial ante la SEP?', 'a': 'Sí. Nuestros planes de estudio tienen reconocimiento y validez oficial ante la Secretaría de Educación Pública.'},
            ]),
            _b('testimonials'),
            _b('cta_band', title='Asegure su lugar', text='El pre-registro toma menos de 5 minutos.', cta={'label': 'Pre-registro en línea', 'href': '/pre-registro'}),
        ],
    },
    'costos': {
        'title': 'Costos',
        'seo': {'title': 'Costos · Colegio Interlaken', 'description': 'Inscripción, colegiaturas, seguros, extraescolares y estancia por nivel.'},
        'blocks': [
            _b('hero', title='Costos', subtitle='Inscripción, colegiaturas, seguros, extraescolares y estancia del ciclo vigente.', image=Img('facade.webp')),
            _b('pricing_table'),
            _b('rich_text', html='<p><small>Cifras informativas. Los pagos se realizan en la administración del colegio o por los medios que ésta indique.</small></p>'),
        ],
    },
    'modelo-educativo': {
        'title': 'Modelo educativo',
        'seo': {'title': 'Modelo educativo · Colegio Interlaken', 'description': 'Bilingüismo, valores y conciencia ambiental en los tres niveles.'},
        'blocks': [
            _b('hero', title='Modelo educativo', subtitle='Bilingüismo, valores y conciencia ambiental en cada etapa.', image=Img('campus-mural.webp')),
            _b('feature_grid', items=[
                {'title': 'Bilingüe', 'text': 'Español–Inglés en los tres niveles, con preparación para el First Certificate de la Universidad de Cambridge en Secundaria.'},
                {'title': 'Valores', 'text': 'Formamos mejores seres humanos: valores en el quehacer diario, ayuda y servicio a la comunidad, ceremonias y convivencia.'},
                {'title': 'Medio ambiente', 'text': 'Conciencia ambiental transversal en actividades, campañas y proyectos escolares.'},
            ]),
            _b('levels_cards'),
            _b('sep_incorporation'),
        ],
    },
    'plataformas': {
        'title': 'Plataformas',
        'seo': {'title': 'Plataformas · Colegio Interlaken', 'description': 'Aula digital, correo institucional y registro de iPad.'},
        'blocks': [
            _b('hero', title='Plataformas', subtitle='Las herramientas digitales de la comunidad Interlaken.', image=Img('secundaria.webp')),
            _b('feature_grid', items=[
                {'title': 'Aula digital', 'text': 'Aulas virtuales del colegio: tareas, materiales y seguimiento de cada clase.'},
                {'title': 'Correo institucional', 'text': 'Correo electrónico oficial de alumnos y docentes (@interlaken).'},
                {'title': 'Mosyle, registro de iPad', 'text': 'Inscripción del iPad al sistema del colegio para usarlo en el salón de clases.'},
                {'title': 'Escuela para padres', 'text': 'Cursos y contenidos diseñados para fortalecer la dinámica familiar y acompañar la crianza.'},
            ]),
        ],
    },
    'documentacion': {
        'title': 'Documentación',
        'seo': {'title': 'Documentación · Colegio Interlaken', 'description': 'Documentos requeridos para la inscripción.'},
        'blocks': [
            _b('hero', title='Documentación', subtitle='Lo que necesita para completar la inscripción.', image=Img('primaria-gate.webp')),
            _b('rich_text', html='<ul><li>Acta de nacimiento (copia)</li><li>CURP del alumno</li><li>Boleta o constancia del último grado cursado</li>'
                                 '<li>Certificado médico reciente</li><li>Identificación oficial de madre, padre o tutor</li><li>Comprobante de domicilio</li>'
                                 '<li>Fotografías tamaño infantil</li></ul>'),
            _b('form', form='pre-registro'),
        ],
    },
    'galeria': {
        'title': 'Galería',
        'seo': {'title': 'Galería · Colegio Interlaken', 'description': 'Imágenes de la vida escolar en Interlaken.'},
        'blocks': [
            _b('hero', title='Galería', subtitle='La vida diaria en Interlaken.', image=Img('court-wide.webp')),
            _b('gallery', images=Gallery(None)),
        ],
    },
    'contacto': {
        'title': 'Contacto',
        'seo': {'title': 'Contacto · Colegio Interlaken', 'description': 'Dirección, teléfono, horario y cómo llegar.'},
        'blocks': [
            _b('hero', title='Contacto', subtitle='Estamos para atenderle.', image=Img('primaria-gate.webp')),
            _b('map_contact'),
            _b('faq', items=[
                {'q': '¿Cómo agendo una visita?', 'a': 'Desde Pre-registro puede elegir una clase abierta o una visita individual.'},
                {'q': '¿Cómo recupero la contraseña del portal?', 'a': 'Escríbanos por WhatsApp o correo y la dirección le enviará una nueva contraseña.'},
            ]),
        ],
    },
}

# SEO fields the seed wrote. Seo titles carry « · Colegio Interlaken» themselves, so the site
# showed it twice; they also replace the template's own title (the yearly «Costos» one).
SEED_SEO: dict[str, dict[str, str]] = {slug: dict(p['seo']) for slug, p in SEED_PAGES.items()}

_ABSENT = object()


def _empty(v) -> bool:
    return v is None or v == '' or v == [] or v == {}


def _norm(v):
    """Drop empty values (None, '', [], {}) from dicts, recursively; lists keep their length."""
    if isinstance(v, dict):
        out = {}
        for k, x in v.items():
            x = _norm(x)
            if not _empty(x):
                out[k] = x
        return out
    if isinstance(v, list):
        return [_norm(x) for x in v]
    return v


AssetName = Callable[[int], 'str | None']   # media id -> file name, None when the asset no longer exists


def _match(pattern, value, asset_name: AssetName) -> bool:
    if isinstance(pattern, OneOf):
        return any(_match(_norm(o) if not isinstance(o, (Img, OneOf, Gallery)) else o, value, asset_name) for o in pattern.options)
    if isinstance(pattern, Img):
        if value is _ABSENT:
            return True
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            return False
        name = asset_name(value)
        return name is None or name == pattern.name
    if isinstance(pattern, Gallery):
        return _match_gallery(pattern, value, asset_name)
    if value is _ABSENT:
        return _empty(_norm(pattern))
    if isinstance(pattern, dict):
        if not isinstance(value, dict):
            return False
        pattern = {k: v for k, v in pattern.items() if isinstance(v, (Img, OneOf, Gallery)) or not _empty(_norm(v))}
        if set(value) - set(pattern):
            return False
        return all(_match(p, value.get(k, _ABSENT), asset_name) for k, p in pattern.items())
    if isinstance(pattern, list):
        return isinstance(value, list) and len(value) == len(pattern) and all(
            _match(p, v, asset_name) for p, v in zip(pattern, value, strict=True))
    return pattern == value


def _match_gallery(pattern: Gallery, value, asset_name: AssetName) -> bool:
    if value is _ABSENT:
        return True   # the seed found no photos to import
    if not isinstance(value, list):
        return False
    expected = list(pattern.names) if pattern.names is not None else None
    pos = 0
    for item in value:
        if not isinstance(item, dict) or set(item) - {'image', 'caption'}:
            return False
        image, caption = item.get('image'), item.get('caption', '')
        if isinstance(image, bool) or not isinstance(image, int) or image <= 0:
            return False
        name = asset_name(image)
        if expected is not None:
            # A subsequence of the named photos (the ones the seed found), each with its own caption.
            while pos < len(expected) and ASSET_ALTS[expected[pos]] != caption:
                pos += 1
            if pos == len(expected) or (name is not None and name != expected[pos]):
                return False
            pos += 1
        else:
            # Every imported photo, captioned from ASSET_ALTS ('' for the others).
            if caption and caption not in ASSET_ALTS.values():
                return False
            if name is not None and ASSET_ALTS.get(name, '') != caption:
                return False
    return True


@dataclass
class SeedComparison:
    matches: bool
    differences: list[str]   # plain Spanish, for the «revisar a mano» list


def compare_to_seed(slug: str, title: str, blocks, seo, asset_name: AssetName) -> SeedComparison:
    """Whether a page still holds exactly what the old seed wrote (title, blocks, SEO)."""
    seed = SEED_PAGES.get(slug)
    if seed is None:
        return SeedComparison(False, ['no es una página de la semilla'])
    diffs: list[str] = []
    if (title or '').strip() != seed['title']:
        diffs.append(f'el título cambió («{seed["title"]}» → «{title}»)')
    blocks = blocks if isinstance(blocks, list) else []
    expected = seed['blocks']
    if len(blocks) != len(expected):
        diffs.append(f'tiene {len(blocks)} bloques (la semilla tenía {len(expected)})')
    for n, (want, got) in enumerate(zip(expected, blocks, strict=False), start=1):
        want_type, want_props = want
        if not isinstance(got, dict) or got.get('type') != want_type:
            diffs.append(f'bloque {n}: el tipo cambió')
            continue
        if got.get('hidden') is True:
            diffs.append(f'bloque {n} ({want_type}): está oculto')
        props = _norm(got.get('props') or {})
        if not _match(want_props, props if isinstance(props, dict) else {}, asset_name):
            diffs.append(f'bloque {n} ({want_type}): el contenido cambió')
    # «No indexar» off is the default, not an edit.
    seo = _norm({k: v for k, v in (seo if isinstance(seo, dict) else {}).items() if v is not False})
    if seo != _norm(seed['seo']):
        diffs.append('el SEO cambió')
    return SeedComparison(not diffs, diffs)


def seed_seo_fields(slug: str, seo) -> dict[str, str]:
    """The SEO fields that still hold the old seed values ({} when none)."""
    seed = SEED_SEO.get(slug)
    if not seed or not isinstance(seo, dict):
        return {}
    return {k: v for k, v in seed.items() if isinstance(seo.get(k), str) and seo[k].strip() == v}
