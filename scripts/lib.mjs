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
// **正则字面量里的引号也要认。** `/["\u2019]/` 这种写法一出现，那个引号
// 就被当成字符串开头，从那儿往后又全反了。写这一节时就撞上了：
// 按句断行那个正则里带着收口的引号，于是它下面的注释被当成文案扫。
//
// 认正则靠的是位置：`/` 前面那个有意义的字符决定它是除号还是正则开头。
// 见 ARCHITECTURE 4.118 末尾。
// 这是各家高亮器都在用的那条老启发式，不是真解析器 —— 够用，
// 认错的代价也只是多扫或少扫一段。
const RE_OK = /[([{,;:=!&|?+\-*%~^<>]$/;
const RE_WORD = /\b(return|typeof|instanceof|in|of|new|delete|void|do|else|case|yield|await)$/;

function regexHere(before) {
  const t = before.replace(/\s+$/, '');
  if (!t) return true;
  return RE_OK.test(t) || RE_WORD.test(t);
}

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
    // 正则字面量。整段原样抄过去，里面的引号不参与计数
    if (c === '/' && regexHere(out)) {
      let j = i + 1;
      let cls = false;
      while (j < src.length) {
        const k = src[j];
        if (k === '\\') { j += 2; continue; }
        if (k === '\n') break;                  // 没收口，那就不是正则
        if (k === '[') cls = true;
        else if (k === ']') cls = false;
        else if (k === '/' && !cls) { j += 1; break; }
        j += 1;
      }
      if (j > i + 1 && src[j - 1] === '/') { out += src.slice(i, j); i = j; continue; }
    }
    if (t === '{') {
      if (c === '{') { stack.push('{'); out += c; i += 1; continue; }
      if (c === '}') { stack.pop(); out += c; i += 1; continue; }
    }
    out += c; i += 1;
  }
  return out;
}
