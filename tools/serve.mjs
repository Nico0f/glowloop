// Zero-dependency static server for local testing.
// Sends the Content-Security-Policy that YouTube Playables enforces, so any
// violation (external request, blocked API) shows up in the console locally.
//
// Usage: node tools/serve.mjs [dir=src] [port=8080]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] || 'src');
const port = Number(process.argv[3] || 8080);

const CSP =
  "default-src 'none'; script-src 'report-sample' 'self' 'unsafe-eval' 'unsafe-inline' blob: " +
  'https://www.youtube.com/game_api/v0 https://www.youtube.com/game_api/v0/ ' +
  'https://www.youtube.com/game_api/v1 https://www.youtube.com/game_api/v1/; ' +
  "object-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "img-src 'self' blob: data:; media-src 'self' blob:; " +
  "font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com; " +
  "connect-src 'self' blob: data:; sandbox allow-pointer-lock allow-same-origin allow-scripts; " +
  "base-uri 'self'; manifest-src 'self'; worker-src 'self' blob:";

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!path.startsWith(root)) throw new Error('outside root');
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    const headers = {
      'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    };
    if (extname(path) === '.html') headers['Content-Security-Policy'] = CSP;
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, () => {
  console.log(`Serving ${root} at http://localhost:${port} (Playables CSP enabled)`);
});
