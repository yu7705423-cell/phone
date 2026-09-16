import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

export const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SKIP = new Set(['node_modules', '.git', 'vendor', '.claude']);

export function walk(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function sources(exts = ['.js', '.mjs', '.css', '.html']) {
  return walk().filter(f => exts.includes(extname(f)));
}

export const read = f => readFileSync(f, 'utf8');
export const rel = f => relative(ROOT, f);

export function report(name, problems) {
  if (!problems.length) {
    console.log(`  ok   ${name}`);
    return 0;
  }
  console.log(`  FAIL ${name}  (${problems.length})`);
  problems.slice(0, 20).forEach(p => console.log(`       ${p}`));
  if (problems.length > 20) console.log(`       ... 还有 ${problems.length - 20} 处`);
  return 1;
}
