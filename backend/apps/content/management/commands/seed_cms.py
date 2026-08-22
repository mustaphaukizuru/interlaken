"""
seed_cms: version 1 of the CMS pages (BACKLOG P3-2).

Imports the site images from frontend/public/assets into the media library
(deduplicated by SHA-256, so re-running never duplicates) and creates draft
pages with the current copy as blocks. Existing pages are left untouched
unless --force; nothing is published unless --publish (hard-coded routes
still win until P3-5 removes them).

    python manage.py seed_cms [--assets DIR] [--publish] [--force]
"""
from __future__ import annotations

import hashlib
import mimetypes
import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from apps.content.media import MediaAsset, build_variants
from apps.content.pages import Page, validate_blocks

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


def _b(type_: str, **props) -> dict:
    return {'id': f'b_{uuid.uuid4().hex[:8]}', 'type': type_, 'props': props}


def page_definitions(img: dict[str, int]) -> list[dict]:
    """Seed pages; `img` maps filename -> MediaAsset id (missing images are simply omitted)."""
    def pic(name):
        return img.get(name)

    gallery_home = [n for n in ('interlaken-image (1).webp', 'interlaken-image (2).webp', 'interlaken-image (4).webp', 'classroom.webp') if pic(n)]
    return [
        {
            'slug': 'inicio', 'title': 'Inicio', 'template': 'home',
            'seo': {'title': 'Colegio Interlaken · Preescolar, Primaria y Secundaria bilingüe',
                    'description': 'Colegio bilingüe con incorporación SEP. Inglés diario desde preescolar, valores y comunidad.'},
            'blocks': [
                _b('hero', title='Educación bilingüe con valores',
                   subtitle='Preescolar, Primaria y Secundaria con inglés todos los días, en una comunidad que conoce a cada familia por su nombre.',
                   image=pic('facade.webp'), cta={'label': 'Agendar visita', 'href': '/pre-registro'}),
                _b('stats', items=[{'value': '95%', 'label': 'Aprovechamiento'}, {'value': '3', 'label': 'Niveles educativos'},
                                   {'value': 'SEP', 'label': 'Incorporación oficial'}, {'value': '100%', 'label': 'Inglés diario'}]),
                _b('levels_cards'),
                _b('feature_grid', title='Por qué Interlaken', items=[
                    {'title': 'Inglés desde preescolar, todos los días', 'text': 'Modelo bilingüe con certificaciones internacionales.'},
                    {'title': 'Formamos personas íntegras y felices', 'text': 'Comunidad y valores en cada etapa.'},
                    {'title': 'Incorporación oficial SEP', 'text': 'Validez oficial en los tres niveles.'},
                ]),
                _b('gallery', images=[{'image': pic(n), 'caption': ASSET_ALTS[n]} for n in gallery_home]),
                _b('testimonials'),
                _b('calendar'),
                _b('cta_band', title='Conozca el colegio', text='Agende una visita individual o una clase abierta.',
                   cta={'label': 'Agendar visita', 'href': '/pre-registro'}),
            ],
        },
        {
            'slug': 'nosotros', 'title': 'Nosotros', 'template': 'simple',
            'seo': {'title': 'Nosotros · Colegio Interlaken', 'description': 'Historia, misión y valores del Colegio Interlaken.'},
            'blocks': [
                _b('hero', title='Nosotros', subtitle='Una comunidad educativa con décadas de trayectoria.', image=pic('facade-sign.webp')),
                _b('rich_text', html='<h2>Misión</h2><p>Formar personas íntegras, bilingües y felices, capaces de transformar su entorno.</p>'
                                     '<h2>Visión</h2><p>Ser el colegio de referencia en formación bilingüe con valores en la región.</p>'),
                _b('timeline', items=[]),
                _b('sep_incorporation'),
                _b('map_contact'),
            ],
        },
        {
            'slug': 'galeria', 'title': 'Galería', 'template': 'simple',
            'seo': {'title': 'Galería · Colegio Interlaken', 'description': 'Imágenes de la vida escolar en Interlaken.'},
            'blocks': [
                _b('hero', title='Galería', subtitle='La vida diaria en Interlaken.', image=pic('court-wide.webp')),
                _b('gallery', images=[{'image': i, 'caption': ASSET_ALTS.get(n, '')} for n, i in img.items()]),
            ],
        },
        {
            'slug': 'contacto', 'title': 'Contacto', 'template': 'simple',
            'seo': {'title': 'Contacto · Colegio Interlaken', 'description': 'Dirección, teléfono, horario y cómo llegar.'},
            'blocks': [
                _b('hero', title='Contacto', subtitle='Estamos para atenderle.', image=pic('primaria-gate.webp')),
                _b('map_contact'),
                _b('faq', items=[
                    {'q': '¿Cómo agendo una visita?', 'a': 'Desde Pre-registro puede elegir una clase abierta o una visita individual.'},
                    {'q': '¿Cómo recupero la contraseña del portal?', 'a': 'Escríbanos por WhatsApp o correo y la dirección le enviará una nueva contraseña.'},
                ]),
            ],
        },
    ]


def import_assets(assets_dir: Path, stdout=None) -> dict[str, int]:
    """Copy every image in assets_dir into MediaAsset (deduplicated by sha256). Returns filename -> id."""
    out: dict[str, int] = {}
    for path in sorted(assets_dir.glob('*')):
        if path.suffix.lower() not in ('.webp', '.jpg', '.jpeg', '.png'):
            continue
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        asset = MediaAsset.objects.filter(sha256=digest).first()
        if asset is None:
            asset = MediaAsset(filename=path.name, content_type=mimetypes.guess_type(path.name)[0] or 'image/webp',
                               size=len(data), sha256=digest, alt=ASSET_ALTS.get(path.name, ''), tags='sitio')
            asset.file.save(path.name, ContentFile(data), save=False)
            asset.save()
            asset.variants = build_variants(asset)
            asset.save(update_fields=['variants', 'width', 'height'])
            if stdout:
                stdout.write(f'  + {path.name}')
        out[path.name] = asset.pk
    return out


class Command(BaseCommand):
    help = 'Seed CMS pages and media from the current site copy (idempotent).'

    def add_arguments(self, parser):
        parser.add_argument('--assets', default=str(settings.BASE_DIR.parent / 'frontend' / 'public' / 'assets'))
        parser.add_argument('--publish', action='store_true', help='Publish the seeded pages as version 1.')
        parser.add_argument('--force', action='store_true', help='Overwrite the draft of pages that already exist.')

    def handle(self, *args, **opts):
        assets_dir = Path(opts['assets'])
        img = import_assets(assets_dir, self.stdout) if assets_dir.is_dir() else {}
        if not img:
            self.stdout.write(self.style.WARNING(f'Sin imágenes en {assets_dir}; las páginas se crean sin fotos.'))
        created = updated = skipped = 0
        for d in page_definitions(img):
            blocks = validate_blocks(d['blocks'])
            page = Page.objects.filter(slug=d['slug']).first()
            if page is None:
                page = Page.objects.create(slug=d['slug'], title=d['title'], template=d['template'], draft_blocks=blocks, seo=d['seo'])
                created += 1
            elif opts['force']:
                page.draft_blocks, page.seo = blocks, d['seo']
                page.save(update_fields=['draft_blocks', 'seo', 'updated_at'])
                updated += 1
            else:
                skipped += 1
                continue
            if opts['publish']:
                page.publish(None)
        self.stdout.write(self.style.SUCCESS(
            f'Medios: {len(img)} · Páginas creadas {created}, actualizadas {updated}, sin cambios {skipped}.'))
