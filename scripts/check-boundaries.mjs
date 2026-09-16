import { sources, read, rel, report } from './lib.mjs';

// apps 之间不能互相 import,也不能直接 import system/。见 CLAUDE.md 第 5 条
const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

export function check() {
  const problems = [];

  for (const file of sources(['.js'])) {
    const path = rel(file);
    if (!path.startsWith('src/apps/')) continue;
    if (path === 'src/apps/index.js') continue;   // 注册入口,允许接触 registry

    const owner = path.split('/')[2];
    const src = read(file);
    let m;
    IMPORT.lastIndex = 0;
    while ((m = IMPORT.exec(src))) {
      const spec = m[1];
      const line = src.slice(0, m.index).split('\n').length;

      const other = spec.match(/apps\/([^/]+)\//);
      if (other && other[1] !== owner) {
        problems.push(`${path}:${line}  app "${owner}" 引用了 app "${other[1]}"，请改走 Intent`);
      }
      if (/(^|\/)system\//.test(spec) && !/system\/db\/(images|defaults)\.js$/.test(spec)
          && !/system\/ai\/providers\/index\.js$/.test(spec)) {
        problems.push(`${path}:${line}  app 直接引用了 ${spec}，应当通过 sdk`);
      }
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('模块边界', check()));
}
