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
