/**
 * Guards the two failure modes that shipped silently before:
 *
 *  1. an asset reference pointing at a file that is not there (the homepage
 *     strip generated `interlaken-image (${i + 1}).webp` from a loop index, so
 *     de-duplicating the folder broke it without a single test noticing), and
 *  2. the same photograph shipped under two names, which doubled its weight in
 *     both the Docker image and the PWA precache.
 *
 * It also refuses dynamically-built asset paths outright: a path assembled at
 * runtime cannot be verified by anything, which is what allowed (1).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS_DIR = path.join(FRONTEND, 'public', 'assets');
const SCAN_DIRS = [path.join(FRONTEND, 'src'), path.join(FRONTEND, 'public')];
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.css', '.html', '.json', '.webmanifest']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'assets') continue;
      walk(full, out);
    } else if (CODE_EXT.has(path.extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

const codeFiles = SCAN_DIRS.flatMap((d) => walk(d));
const assetFiles = readdirSync(ASSETS_DIR).filter((f) =>
  statSync(path.join(ASSETS_DIR, f)).isFile(),
);

// Stops at the closing quote/backtick, so filenames containing spaces and
// parentheses — which several of these have — are captured whole.
const ASSET_REF = /\/assets\/([^"'`]+?\.(?:webp|png|jpg|jpeg|svg|ico))/g;

describe('public assets', () => {
  it('every referenced asset exists on disk', () => {
    const broken: string[] = [];
    for (const file of codeFiles) {
      const text = readFileSync(file, 'utf8');
      for (const [, name] of text.matchAll(ASSET_REF)) {
        if (name.includes('${') || name.includes('*')) continue; // covered below
        if (!assetFiles.includes(name)) {
          broken.push(`${path.relative(FRONTEND, file)} -> /assets/${name}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('no asset path is assembled at runtime', () => {
    const dynamic: string[] = [];
    for (const file of codeFiles) {
      const text = readFileSync(file, 'utf8');
      for (const [, name] of text.matchAll(ASSET_REF)) {
        if (name.includes('${')) dynamic.push(`${path.relative(FRONTEND, file)} -> /assets/${name}`);
      }
    }
    expect(dynamic).toEqual([]);
  });

  it('ships no byte-identical duplicates', () => {
    const byHash = new Map<string, string[]>();
    for (const name of assetFiles) {
      const hash = createHash('md5').update(readFileSync(path.join(ASSETS_DIR, name))).digest('hex');
      byHash.set(hash, [...(byHash.get(hash) ?? []), name]);
    }
    // A .webp and its .png source are the intended pair, never byte-identical,
    // so any collision here is a genuine duplicate.
    const dupes = [...byHash.values()].filter((names) => names.length > 1);
    expect(dupes).toEqual([]);
  });
});

/**
 * Internal links must point at routes that exist. Removing a feature deletes
 * its <Route>, but a <Link> left behind elsewhere still renders and still
 * looks clickable — it just lands on the 404 page. That is how the parent
 * portal kept offering "Pagar colegiaturas" after tuition billing was removed.
 */
const APP_TSX = path.join(FRONTEND, 'src', 'App.tsx');

function declaredRoutes(): string[] {
  const routes: string[] = [];
  const stack: string[] = [];
  for (const raw of readFileSync(APP_TSX, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('<Route')) {
      const m = line.match(/<Route\s+(?:index\s+)?(?:path="([^"]*)")?/);
      const p = m?.[1];
      if (p !== undefined || line.includes('index')) {
        const full = `/${[...stack, p ?? ''].join('/')}`.replace(/\/+/g, '/');
        routes.push(full.length > 1 ? full.replace(/\/$/, '') : '/');
      }
      if (!line.endsWith('/>')) stack.push(p ?? '');
    }
    if (line.includes('</Route>') && stack.length) stack.pop();
  }
  return routes;
}

function matches(link: string, route: string): boolean {
  if (route.endsWith('/*')) return link === route.slice(0, -2) || link.startsWith(route.slice(0, -1));
  const rx = new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}$`);
  return rx.test(link);
}

describe('internal links', () => {
  it('every <Link to="/..."> and navigate("/...") target resolves to a route', () => {
    const routes = declaredRoutes().filter((r) => r !== '/*');
    const dead: string[] = [];
    // Tests are excluded: they reference routes as fixtures (MemoryRouter
    // entries, and this file's own documentation of the pattern it matches).
    const tsx = codeFiles.filter(
      (f) => ['.ts', '.tsx'].includes(path.extname(f))
        && !f.includes(`${path.sep}test${path.sep}`)
        && !/\.test\.tsx?$/.test(f),
    );
    for (const file of tsx) {
      if (file.endsWith('App.tsx')) continue;
      const text = readFileSync(file, 'utf8');
      const targets = [
        ...[...text.matchAll(/\bto="(\/[^"]*)"/g)].map((m) => m[1]),
        ...[...text.matchAll(/navigate\(\s*'(\/[^']*)'/g)].map((m) => m[1]),
      ];
      for (const raw of targets) {
        // Drop query/hash, and skip anything built at runtime.
        const link = raw.split(/[?#]/)[0];
        if (link.includes('${') || link === '/') continue;
        if (!routes.some((r) => matches(link, r))) {
          dead.push(`${path.relative(FRONTEND, file)} -> ${link}`);
        }
      }
    }
    expect(dead).toEqual([]);
  });
});
