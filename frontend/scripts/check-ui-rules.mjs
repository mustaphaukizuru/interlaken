#!/usr/bin/env node
/**
 * check-ui-rules.mjs: the design-system rules a reviewer should never have to
 * catch by eye (docs/DESIGN.md, docs/decisions/0001-0003). Runs in CI after
 * lint; `npm run check:ui` locally.
 *
 *  1. Radius: only rounded-sm (8px controls), rounded-md (12px surfaces),
 *     rounded-full (badges, avatars, switch thumbs, dots) and rounded-none,
 *     with their side variants. No rounded-lg/xl/2xl/3xl/xl2/xl3/xl4, no bare
 *     `rounded`, no arbitrary rounded-[…].
 *  2. Layers: no arbitrary z-[…] and no global z-20…z-50 numbers; use the
 *     scale (z-sticky, z-header, z-dropdown, z-drawer, z-modal, z-toast,
 *     z-overlay). z-0 / z-10 stay allowed for stacking inside one component.
 *  3. Colour: no raw hex in components outside the allowlist below.
 *
 * Each rule has an ALLOW list of `path` (or `path:reason`) entries. Adding to
 * it is a reviewed decision.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../src', import.meta.url));

const SIDE = '(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?';
const BAD_RADIUS = new RegExp(
  `(?<![\\w\\-/.\\[])(?:[a-z0-9\\-]+:)*rounded${SIDE}(?:-(?:lg|xl|2xl|3xl|xl2|xl3|xl4|\\[[^\\]\\s]+\\]))(?![\\w\\-\\[])`,
  'g',
);
// bare `rounded` / `rounded-t` used as a class (not an identifier like `rounded?:`)
const BARE_RADIUS = new RegExp(`(?<![\\w\\-/.\\[])(?:[a-z0-9\\-]+:)*rounded${SIDE}(?=["'\` ])(?!\\s*[?:=,})(])`, 'g');
const BAD_Z = /(?<![\w\-/.[])(?:[a-z0-9-]+:)*-?z-(?:\[[^\]\s]+\]|[2-9]\d|\d{3,})(?![\w-])/g;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

const HEX_ALLOW = new Set([
  'components/icons', // official third-party marks (Google "G")
  'cms/sections/acceso.tsx', // the official Google "G" in the sign-in button
  'components/ui/Barcode.tsx', // scanner contrast #111827
  'lib/chartTheme.ts', // chart palette is the token mirror for SVG
  'cms/editor/fields/ColorField.tsx', // the colour picker shows hex values
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const problems = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const where = `src/${rel}:${i + 1}`;
    if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return; // comments document the rules
    for (const m of line.matchAll(BAD_RADIUS)) problems.push(`${where}  radius  ${m[0]} → rounded-sm | rounded-md | rounded-full`);
    for (const m of line.matchAll(BARE_RADIUS)) problems.push(`${where}  radius  bare "${m[0]}" → rounded-sm`);
    for (const m of line.matchAll(BAD_Z)) problems.push(`${where}  layer   ${m[0]} → z-sticky | z-header | z-dropdown | z-drawer | z-modal | z-toast | z-overlay`);
    if (![...HEX_ALLOW].some((a) => rel.startsWith(a))) {
      for (const m of line.matchAll(HEX)) {
        // skip HTML entities (&#8199;) and hashes inside URLs/anchors
        const before = line.slice(Math.max(0, m.index - 1), m.index);
        if (before === '&' || /["'`]\/?[\w-]*$/.test(line.slice(0, m.index)) && /^#[0-9a-f]{3,8}[\w-]/.test(line.slice(m.index))) continue;
        problems.push(`${where}  colour  ${m[0]} → a token (index.css / tailwind.config.js)`);
      }
    }
  });
}

if (problems.length) {
  console.error(`check:ui found ${problems.length} problem(s):\n`);
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('check:ui: radius, layer and colour rules hold.');
