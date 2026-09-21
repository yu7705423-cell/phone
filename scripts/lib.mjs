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

// 去掉注释，只留代码。字符串里的 // 不算注释，所以要边走边认引号。
//
// **模板串里的 ${} 那一段是代码，里面还能再套模板串。** 这个代码库里
// `class=${`a${x ? "b" : "c"}`}` 这种写法到处都是；不认嵌套的话，内层那个
// 反引号会把外层提前收掉，从那儿往后引号状态整个反过来 —— 结果就是
// 注释被当成文案扫、真的文案反而漏掉。这个检查曾经在半个项目上是瞎的。
//
// 还剩一个已知的坑：正则字面量里的引号（/['"]/）同样会被当成字符串开头。
// 要彻底解决得上真的解析器，这里先不做 —— 那一类写法本项目里没有。
export function stripComments(src) {
  let out = '';
  let i = 0;
  // 状态栈：` " ' 是各种字符串，{ 是模板串里 ${} 的那一段（按代码处理）
  const stack = [];
  const top = () => stack[stack.length - 1] || null;

  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    const t = top();

    if (t === '"' || t === "'") {
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === t) stack.pop();
      out += c; i += 1; continue;
    }
    if (t === '`') {
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === '$' && n === '{') { stack.push('{'); out += c + n; i += 2; continue; }
      if (c === '`') stack.pop();
      out += c; i += 1; continue;
    }

    // 到这儿就是代码（顶层，或者 ${} 里面）
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') { stack.push(c); out += c; i += 1; continue; }
    if (t === '{') {
      if (c === '{') { stack.push('{'); out += c; i += 1; continue; }
      if (c === '}') { stack.pop(); out += c; i += 1; continue; }
    }
    out += c; i += 1;
  }
  return out;
}
