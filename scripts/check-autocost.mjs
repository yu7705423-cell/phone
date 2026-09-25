import { read, rel, report, sources, ROOT } from './lib.mjs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// 自动调接口的地方，每一处都要有一项「接口一直失败时打出去几次」的测试（CLAUDE.md 第 15 条，ARCHITECTURE 4.241）。
//
// 用户要求加的这道闸。「失败了之后一直重试、一条消息扣几次」已经犯过很多次，每次都是同一种写法：
// 成功了才记「做过了」。正常路径的测试一个都抓不住它 —— 接口好好的时候一切正常。
// 只有让接口一直失败、数真正打出去几次，才看得出来。
//
// 哪些算「自动的」，从代码里机械地找：
//   · system/ai/usage.js 里标了 auto: true 的每个任务 id
//   · 每天一次的：代码里每一处 claim('名字', ...)（system/ai/daily.js），记作 daily:名字
//   · 定时问「该不该开口」的：apps 里每一处 xxx.due()，记作 due:xxx
//
// 每一项都要在 tests/autocost*.test.mjs 的 COVERS 表里有一行「id: 断言名」，
// 而且那个断言名真的是那个文件里的一个 ok('…')。新加一个自动任务却没写失败测试，这里就拦下来。

export function check() {
  const problems = [];
  const need = new Map();

  const usage = read(join(ROOT, 'src/system/ai/usage.js'));
  const re = /^\s*'?([\w.-]+)'?:\s*\{[^}\n]*auto:\s*true/gm;
  let m;
  while ((m = re.exec(usage))) need.set(m[1], 'src/system/ai/usage.js 标了 auto: true');

  for (const file of sources(['.js'])) {
    const name = rel(file);
    if (!name.startsWith('src/')) continue;
    const src = read(file);
    if (name !== 'src/system/ai/daily.js') {
      const cr = /\bclaim\(\s*'([\w.-]+)'/g;
      while ((m = cr.exec(src))) need.set(`daily:${m[1]}`, `${name} 每天一次`);
    }
    if (name.startsWith('src/apps/')) {
      const dr = /\b(\w+)\.due\(\)/g;
      while ((m = dr.exec(src))) need.set(`due:${m[1]}`, `${name} 定时问该不该开口`);
    }
  }

  const covers = new Map();
  const dir = join(ROOT, 'tests');
  for (const f of readdirSync(dir).filter(x => /^autocost.*\.test\.mjs$/.test(x))) {
    const src = read(join(dir, f));
    const block = src.match(/const COVERS = \{([\s\S]*?)\n\};/);
    if (!block) continue;
    const lr = /^\s*'([^']+)':\s*'([^']+)',?\s*$/gm;
    while ((m = lr.exec(block[1]))) {
      if (!src.includes(`ok('${m[2]}'`)) problems.push(`tests/${f}  COVERS 里 ${m[1]} 对应的断言「${m[2]}」不存在`);
      covers.set(m[1], f);
    }
  }

  for (const [id, why] of need) {
    if (!covers.has(id)) {
      problems.push(`${id}（${why}）没有「接口一直失败」的测试。在 tests/autocost*.test.mjs 的 COVERS 里登记一项`);
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('自动调用有失败测试', check()));
}
