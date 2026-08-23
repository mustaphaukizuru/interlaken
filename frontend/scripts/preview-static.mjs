#!/usr/bin/env node
/**
 * Serve the production build the way the VPS does (BACKLOG P5-3, Lighthouse CI):
 *   /static/<file>  -> dist/<file>   (vite base is '/static/', whitenoise in prod)
 *   /<file>         -> dist/<file>   (favicons, manifest, sw.js live at the root)
 *   anything else   -> dist/index.html (SPA catch-all, like Django's)
 *   text assets are gzipped like Caddy does, so Lighthouse budgets see real transfer sizes
 * `vite preview` cannot do this (it serves dist at '/'), which is why it painted
 * nothing and Lighthouse reported NO_FCP.
 *
 *   node scripts/preview-static.mjs [port]   (default 4173)
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createGzip } from 'node:zlib';

const GZIP = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.xml']);

const dist = join(process.cwd(), 'dist');
const port = Number(process.argv[2] || process.env.PORT || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.xml': 'application/xml',
};

function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^([/\\])+/, '');
  const rel = clean.startsWith('static/') || clean.startsWith('static\\') ? clean.slice(7) : clean;
  const file = join(dist, rel);
  if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) return file;
  return null;
}

createServer((req, res) => {
  const file = resolve(req.url || '/');
  if (file) {
    const ext = extname(file).toLowerCase();
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' };
    // Caddy gzips text assets in production; do the same so resource budgets measure real transfer size.
    if (GZIP.has(ext) && (req.headers['accept-encoding'] || '').includes('gzip')) {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      createReadStream(file).pipe(createGzip()).pipe(res);
    } else {
      res.writeHead(200, headers);
      createReadStream(file).pipe(res);
    }
    return;
  }
  if ((req.url || '').startsWith('/api/')) {
    // No backend behind the preview: the SPA renders its empty/fallback states.
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end('{"detail":"preview: no backend"}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  createReadStream(join(dist, 'index.html')).pipe(res);
}).listen(port, () => console.log(`preview-static: http://localhost:${port}/ (dist at / and /static/)`));
