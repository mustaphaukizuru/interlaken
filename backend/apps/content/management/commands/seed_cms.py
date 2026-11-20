"""
seed_cms: the site photos in the CMS media library (BACKLOG P3-2).

Imports the images from frontend/public/assets into the media library
(deduplicated by SHA-256, so re-running never duplicates) with alt text, so
the school can pick them in the page editor.

Page copy is no longer seeded here: every public page's default content is
its template in the frontend (cms/sections, docs/CMS-COMPLETION-PLAN.md), and
the editor creates the draft from it the first time a page is customised.

    python manage.py seed_cms [--assets DIR]
"""
from __future__ import annotations

import hashlib
import mimetypes
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from apps.content.media import MediaAsset, build_variants

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
    help = 'Import the site photos into the CMS media library (idempotent).'

    def add_arguments(self, parser):
        parser.add_argument('--assets', default=str(settings.BASE_DIR.parent / 'frontend' / 'public' / 'assets'))

    def handle(self, *args, **opts):
        assets_dir = Path(opts['assets'])
        img = import_assets(assets_dir, self.stdout) if assets_dir.is_dir() else {}
        if not img:
            self.stdout.write(self.style.WARNING(f'Sin imágenes en {assets_dir}.'))
        self.stdout.write(self.style.SUCCESS(f'Medios en la biblioteca: {len(img)}.'))
