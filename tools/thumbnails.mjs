// Renders the store thumbnails and saves them to store/thumbnails/.
//
// Usage: npm run thumbnails, then open the printed URL in a browser.

import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'store', 'thumbnails');
const port = Number(process.argv[2] || 8095);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname.startsWith('/save/')) {
    const name = url.pathname.slice('/save/'.length);
    if (!/^[a-z0-9-]+\.png$/.test(name)) {
      res.writeHead(400).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, name), Buffer.concat(chunks));
    console.log(`saved store/thumbnails/${name}`);
    res.writeHead(200).end('ok');
    return;
  }
  try {
    const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) throw new Error('outside root');
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => {
  console.log(`Open http://localhost:${port}/tools/thumbnails.html to render and save the thumbnails`);
});
