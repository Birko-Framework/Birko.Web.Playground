// Persistent static server for the built playground (wwwroot/) — for interactive review, incl. the
// PWA (service worker needs a real origin; localhost is a secure context). Unlike verify.mjs (which
// serves on an ephemeral port and shuts down when its headless check finishes), this stays running.
//
//   npm run build && npm run serve   → http://localhost:5180
//
// PWA review: load once online (wait for DevTools → Application → Service Workers to show
// "activated"), THEN tick "Offline" and reload — the shell is served from cache.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = 'wwwroot';
const PORT = Number(process.env.PORT) || 5180;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const buf = await readFile(join(ROOT, normalize(p)));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`Playground served at http://localhost:${PORT}/  (Ctrl+C to stop)`);
});
