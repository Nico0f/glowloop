// Builds the YouTube Playables upload bundle and a standalone web preview.
//
//   dist/playables/            the game exactly as YouTube will serve it
//   dist/glowloop-playables.zip  upload this to the Playables developer portal
//   dist/web/                  preview build without the SDK (for sharing/testing)
//
// The build fails if the Playables bundle breaks a certification rule we can
// check statically (banned APIs, absolute paths, bad file names, size limits).

import { mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, relative, extname } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const OUT = join(DIST, 'playables');
const WEB = join(DIST, 'web');
const ZIP = join(DIST, 'glowloop-playables.zip');

const SDK_TAG = '<script src="https://www.youtube.com/game_api/v1"></script>';

// Things the Playables certification requirements forbid in game code.
const BANNED = [
  [/\blocalStorage\b/, 'localStorage (use ytgame.game.saveData)'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bindexedDB\b/, 'IndexedDB'],
  [/document\.cookie/, 'cookies'],
  [/navigator\.languages?\b/, 'navigator.language (use ytgame.system.getLanguage)'],
  [/visibilitychange|document\.hidden|visibilityState/, 'Page Visibility API (use onPause/onResume)'],
  [/\beval\s*\(/, 'eval()'],
  [/new\s+Worker\s*\(/, 'Web Workers'],
  [/\bfetch\s*\(\s*['"`]https?:/, 'external fetch'],
  [/\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/, 'blocking dialogs'],
];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function copyTree(from, to) {
  for (const file of await walk(from)) {
    const dest = join(to, relative(from, file));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(file, dest);
  }
}

function check(files, contents) {
  const errors = [];
  for (const file of files) {
    const rel = relative(OUT, file);
    for (const part of rel.split('/')) {
      if (!/^[A-Za-z0-9_.-]+$/.test(part)) errors.push(`${rel}: file names may only use letters, digits, "_", "-" and "."`);
    }
    const text = contents.get(file);
    if (text === undefined) continue;
    if (/(?:src|href)\s*=\s*["']\/(?!\/)/.test(text) || /import[^'"]*['"]\/(?!\/)/.test(text)) {
      errors.push(`${rel}: uses an absolute path; Playables requires relative paths`);
    }
    if (extname(file) === '.js') {
      for (const [re, label] of BANNED) if (re.test(text)) errors.push(`${rel}: uses ${label}`);
    }
  }
  return errors;
}

// ---------- minimal zip writer (deflate + CRC-32, no dependencies) ----------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const time = 0; // fixed timestamp keeps the zip reproducible
  const date = (2026 - 1980) << 9 | (1 << 5) | 1;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---------- build ----------

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;

await rm(DIST, { recursive: true, force: true });
await copyTree(SRC, OUT);

const files = (await walk(OUT)).sort();
const contents = new Map();
for (const f of files) {
  if (['.html', '.js', '.css', '.json'].includes(extname(f))) contents.set(f, await readFile(f, 'utf8'));
}

const html = contents.get(join(OUT, 'index.html')) || '';
const errors = check(files, contents);
if (!html.includes(SDK_TAG)) errors.push('index.html: missing the Playables SDK script tag');
else if (html.indexOf(SDK_TAG) > html.search(/<script(?![^>]*game_api)/)) {
  errors.push('index.html: the SDK must load before any game script');
}

let total = 0;
for (const f of files) {
  const size = (await stat(f)).size;
  total += size;
  if (size > 30 * 1024 * 1024) errors.push(`${relative(OUT, f)}: over the 30 MiB per-file limit`);
  else if (size > 512 * 1024) console.warn(`warning: ${relative(OUT, f)} is over the recommended 512 KiB`);
}
if (files.length > 8000) errors.push('bundle has more than 8,000 files');
if (total > 30 * 1024 * 1024) errors.push('initial bundle over 30 MiB');

if (errors.length) {
  console.error('Playables checks failed:\n  ' + errors.join('\n  '));
  process.exit(1);
}

const entries = [];
for (const f of files) entries.push({ name: relative(OUT, f), data: await readFile(f) });
const zipped = zip(entries);
await writeFile(ZIP, zipped);

// Web preview: same game without the SDK, best score kept in the browser.
await copyTree(join(SRC, 'js'), join(WEB, 'js'));
const css = await readFile(join(SRC, 'css', 'style.css'), 'utf8');
await writeFile(
  join(WEB, 'js', 'web-store.js'),
  `// Web preview only: stands in for YouTube cloud saves. Not part of the Playables bundle.
window.__glowloopWebStore = {
  load() {
    try {
      return localStorage.getItem('glowloop-save') || '';
    } catch {
      return '';
    }
  },
  save(value) {
    try {
      localStorage.setItem('glowloop-save', value);
    } catch {
      /* storage unavailable */
    }
  },
};
`,
);
await writeFile(
  join(WEB, 'index.html'),
  `<title>Glowloop</title>
<meta name="description" content="Draw glowing loops around fireflies to catch them. Same color scores more; keep moths out.">
<style>
${css.trim()}
</style>
<canvas id="game" aria-label="Glowloop: draw loops around fireflies to catch them"></canvas>
<script src="js/web-store.js"></script>
<script type="module" src="js/main.js"></script>
`,
);

console.log(`Playables bundle: ${files.length} files, ${kib(total)} (zip ${kib(zipped.length)})`);
console.log(`  ${relative(ROOT, ZIP)}`);
console.log('All static Playables checks passed.');
console.log(`Web preview: ${relative(ROOT, WEB)}/index.html`);
