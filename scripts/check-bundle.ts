import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
interface Chunk {
  file: string;
  imports?: string[];
  dynamicImports?: string[];
}
const manifest = JSON.parse(await readFile('apps/web/dist/.vite/manifest.json', 'utf8')) as Record<
  string,
  Chunk
>;
const included = new Set<string>();
function visit(key: string) {
  if (included.has(key)) return;
  const chunk = manifest[key];
  if (!chunk) throw new Error(`Unknown chunk ${key}`);
  included.add(key);
  for (const imported of chunk.imports ?? []) visit(imported);
}
visit('index.html');
const checkin = Object.keys(manifest).find((k) => k.endsWith('/Checkin.vue'));
if (!checkin) throw new Error('Check-in entry missing');
visit(checkin);
let bytes = 0;
const files = [];
for (const key of included) {
  const filename = manifest[key]!.file;
  if (!filename.endsWith('.js')) continue;
  const content = await readFile(`apps/web/dist/${filename}`);
  const gzip = gzipSync(content).byteLength;
  bytes += gzip;
  files.push({ filename, gzip_bytes: gzip });
}
if (bytes > 250 * 1024) throw new Error(`Check-in JS gzip exceeds budget: ${bytes}`);
for (const key of included)
  if (/admin\/|Roster\.vue|EventEditor\.vue|Dashboard\.vue|Records\.vue/.test(key))
    throw new Error('Admin route included in participant entry');
console.log(
  JSON.stringify(
    {
      scope: 'entry + participant route + static imports',
      gzip_kb: Math.round((bytes / 1024) * 10) / 10,
      budget_kb: 250,
      files,
    },
    null,
    2,
  ),
);
