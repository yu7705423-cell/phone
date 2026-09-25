import { sources, read, rel, report } from './lib.mjs';

// 导出了却没人引用的名字。
//
// 无构建方案没有 tree-shaking 替我们发现死代码：一个函数写完没接上调用方，
// 会一直安静地躺在那里，直到某次改 API 把它改坏了都没人知道 ——
// 已经这样漏过一回：删角色时该清掉的日子和吃饭记录，函数写了，调用方忘了。
//
// 判法很粗：每个 export 的名字，在 src/ 里除定义那一行之外找 \bname\b。
// 本文件内部用了也算用了 —— 那只是多导出了一个名字，不是死代码，不在这儿管。
// app 走的是 phone.xxx.name 这种命名空间引用，同样命中，所以不会漏报。
// 一处都找不到就报。同名不同物会误报，人工再看。
//
// 明知没调用方、但故意留着的，写进下面的名单，一行一个理由。
const KEEP = new Map([
  // 识图那三档「到底能不能看见」的判定。产品代码各处自己按 mode 分支，
  // 这一份是那条规则的原样，测试用它钉住三档的语义
  ['src/system/ai/services.js:visionActive', '规则本身，测试钉着'],
  // 角色评论朋友圈。模板与任务都齐了，入口等「特别关心」那一批（批 3）一起做
  ['src/system/ai/tasks/moments.js:commentMoment', '等批 3 的朋友圈弹窗接入'],
  // 搬家时旧网址那一页（根目录 move.html）里的内联脚本调它。这份检查只扫 src/ 下的 js
  ['src/system/move.js:serve', 'move.html 调用'],
]);

const EXPORT = /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s*\{([^}]+)\}/gm;
const escape = s => s.replace(/\$/g, '\\$');

export function check() {
  const files = sources(['.js']).filter(f => rel(f).startsWith('src/'));
  const src = new Map(files.map(f => [f, read(f)]));
  const problems = [];

  for (const [file, text] of src) {
    const names = new Set();
    let m;
    EXPORT.lastIndex = 0;
    while ((m = EXPORT.exec(text))) names.add(m[1]);
    EXPORT_LIST.lastIndex = 0;
    while ((m = EXPORT_LIST.exec(text))) {
      m[1].split(',').forEach(s => {
        const parts = s.trim().split(/\s+as\s+/);
        const n = (parts[1] || parts[0]).trim();
        if (n && n !== 'default') names.add(n);
      });
    }

    for (const name of names) {
      const key = `${rel(file)}:${name}`;
      if (KEEP.has(key)) continue;
      const re = new RegExp(`\\b${escape(name)}\\b`, 'g');
      const defs = (text.match(new RegExp(`^export\\s+(?:async\\s+)?(?:function\\*?|const|let|class)\\s+${escape(name)}\\b`, 'gm')) || []).length;
      let used = (text.match(re) || []).length - defs > 0;
      for (const [f2, t2] of src) {
        if (used) break;
        if (f2 !== file && re.test(t2)) used = true;
        re.lastIndex = 0;
      }
      if (!used) problems.push(`${key}  写了，但没有任何地方调用它`);
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('死导出', check()));
}
