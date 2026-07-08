#!/usr/bin/env python3
"""
Build the React SPA and place its output where Django/whitenoise serves it.

Automates DEPLOYMENT.md §5 steps 2–4:
  1. `npm run build` in frontend/  (Vite base '/static/' — see vite.config.ts)
  2. dist/index.html            -> backend/templates/index.html
  3. dist/assets/*              -> backend/static/assets/
  4. (optional) collectstatic   with --collectstatic

Run from anywhere:  python scripts/build_frontend.py [--collectstatic]

On the cPanel server (no Node), build locally and upload the resulting
backend/templates/index.html + backend/static/assets/, then run
`python manage.py collectstatic` in the cPanel venv.
"""
import argparse
import os
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(REPO, 'frontend')
BACKEND = os.path.join(REPO, 'backend')
DIST = os.path.join(FRONTEND, 'dist')

TEMPLATES = os.path.join(BACKEND, 'templates')
STATIC_ASSETS = os.path.join(BACKEND, 'static', 'assets')


def run(cmd, cwd):
    print(f'\n$ {" ".join(cmd)}  (cwd={cwd})')
    # npm is a .cmd shim on Windows; shell=True lets PATH resolution find it.
    subprocess.run(cmd, cwd=cwd, check=True, shell=(os.name == 'nt'))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--collectstatic', action='store_true',
                    help='run `manage.py collectstatic --noinput` afterwards')
    ap.add_argument('--skip-build', action='store_true',
                    help='reuse an existing dist/ (skip npm run build)')
    args = ap.parse_args()

    if not args.skip_build:
        run(['npm', 'run', 'build'], cwd=FRONTEND)

    index_src = os.path.join(DIST, 'index.html')
    assets_src = os.path.join(DIST, 'assets')
    if not os.path.isfile(index_src):
        sys.exit(f'ERROR: {index_src} not found — did the build succeed?')

    # 2. index.html -> templates/ (overwrites the placeholder shell)
    os.makedirs(TEMPLATES, exist_ok=True)
    shutil.copy2(index_src, os.path.join(TEMPLATES, 'index.html'))
    print(f'copied index.html -> {TEMPLATES}')

    # 3. assets/* -> backend/static/assets/ (replace wholesale so old hashed
    #    bundles don't accumulate)
    if os.path.isdir(STATIC_ASSETS):
        shutil.rmtree(STATIC_ASSETS)
    shutil.copytree(assets_src, STATIC_ASSETS)
    print(f'copied assets/* -> {STATIC_ASSETS}')

    # Any other top-level dist files (favicon, manifest, sw.js, icons) that the
    # SPA references from the site root are copied into backend/static/ too.
    static_root = os.path.join(BACKEND, 'static')
    for name in os.listdir(DIST):
        src = os.path.join(DIST, name)
        if name in ('index.html', 'assets'):
            continue
        dst = os.path.join(static_root, name)
        if os.path.isdir(src):
            if os.path.isdir(dst):
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    print(f'copied root dist files -> {static_root}')

    if args.collectstatic:
        env = dict(os.environ)
        env.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.production')
        print('\n$ python manage.py collectstatic --noinput')
        subprocess.run([sys.executable, 'manage.py', 'collectstatic', '--noinput'],
                       cwd=BACKEND, check=True, env=env)

    print('\nDone. SPA built and staged for Django. '
          'Run collectstatic on the server if you did not pass --collectstatic.')


if __name__ == '__main__':
    main()
