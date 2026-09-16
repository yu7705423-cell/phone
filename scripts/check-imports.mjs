import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { sources, read, rel, report, ROOT } from './lib.mjs';

// 无构建意味着没有打包器替我们校验 import。
// 引用一个已经删掉的导出，要到运行时打开那个页面才会炸，
// 所以在这里静态扫一遍。
const IMPORT_RE = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const STAR_RE = /export\s*\*\s*from/;

function exportsOf(src) {
  const names = new Set();
  const decl = /export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = decl.exec(src))) names.add(m[1]);
  const listed = /export\s*\{([^}]*)\}/g;
  while ((m = listed.exec(src))) {
    m[1].split(',').forEach(part => {
      const as = part.split(/\s+as\s+/);
      const name = (as[1] || as[0]).trim();
      if (name) names.add(name);
    });
  }
  if (/export\s+default/.test(src)) names.add('default');
  return names;
}

export function check() {
  const problems = [];
  for (const file of sources(['.js'])) {
    const src = read(file);
    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(src))) {
      const spec = m[2];
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      const line = src.slice(0, m.index).split('\n').length;
      if (!existsSync(target)) {
        problems.push(`${rel(file)}:${line}  引用了不存在的文件 ${spec}`);
        continue;
      }
      const targetSrc = readFileSync(target, 'utf8');
      if (STAR_RE.test(targetSrc)) continue;    // 转发导出，跳过
      const available = exportsOf(targetSrc);
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        if (!available.has(name)) {
          problems.push(`${rel(file)}:${line}  ${spec} 没有导出 ${name}`);
        }
      }
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('导入导出', check()));
}
