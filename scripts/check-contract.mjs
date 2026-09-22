import { sources, read, rel, report, ROOT } from './lib.mjs';
import { readFileSync } from 'node:fs';

// 美化契约。见 CLAUDE.md 第 18 条与 ARCHITECTURE 4.136
//
// 契约是**给外面的人用的**：别人照着 `ph-` 这套名字写一份美化，我们保证
// 以后不改名。保证要有人查，否则下一次重构顺手把某个钩子挪掉了，
// 谁都不会发现 —— 发现的是几个月后那位作者，而他只会看到自己的美化失效了。
//
// 这里查四件事：
//
//   一、表里写了的钩子，源码里必须真的挂着。写了不挂，文档在骗人
//   二、源码里挂着的 `ph-`，表里必须登记。挂了不写，作者看不到它
//   三、公开变量必须在 tokens.css 里接上内部变量，否则写了也不生效
//   四、挂了钩子的元素上不许再写内联 style
//
// 第四条是最要紧的一条。内联样式赢过任何选择器，作者写什么都盖不住它，
// 而且完全看不出为什么 —— 他只会以为「这个 app 的美化是坏的」。
// 头像的宽高圆角从前就是内联写的，于是谁也改不动头像大小。

const CONTRACT = 'src/system/skin-contract.js';

/** 从契约文件里读出登记过的钩子与变量。不 import，免得给检查脚本引入运行时依赖。 */
function tableOf() {
  const src = readFileSync(`${ROOT}/${CONTRACT}`, 'utf8');
  const hooks = [...src.matchAll(/\{\s*hook:\s*'([a-z0-9-]+)'/g)].map(m => m[1]);
  const vars = [...src.matchAll(/\{\s*name:\s*'(ph-[a-z0-9-]+)'/g)].map(m => m[1]);
  return { hooks: new Set(hooks), vars };
}

/**
 * 一段内联样式里写死了哪几条声明。只设 `--x` 的一条都不算。
 *
 * 先把 `${...}` 挖掉再看：里面常常是地址、三元表达式，带着冒号和分号，
 * 照着切会把一条声明切成好几段。
 */
function hardDecls(text) {
  const inner = text.replace(/\$\{[^}]*\}/g, '\u0000');
  const out = [];
  for (const part of inner.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).replace(/^[^a-zA-Z-]*/, '').trim();
    if (!name || name.startsWith('--')) continue;
    if (!/^[a-zA-Z-]+$/.test(name)) continue;
    out.push(name);
  }
  return [...new Set(out)];
}

export function check() {
  const problems = [];
  const { hooks, vars } = tableOf();
  if (!hooks.size) return [`${CONTRACT} 里一个钩子都没读到，这个检查等于没跑`];

  const used = new Set();
  const files = sources(['.js', '.css']).filter(f => rel(f) !== CONTRACT);

  for (const file of files) {
    const path = rel(file);
    const src = read(file);
    // 源码里出现的 ph- 类名。`phc('msg')` 这种也要认，那是拼类名的助手。
    // **`--ph-x` 不算** —— 那是公开变量，归 VARS 那张表，不是钩子。
    // 少这一个否定环视，每加一个变量就会被报成「挂了没登记的钩子」
    for (const m of src.matchAll(/(?<!-)\bph-([a-z0-9-]+)\b/g)) used.add(m[1]);
    for (const m of src.matchAll(/\bphc\(([^)]*)\)/g)) {
      for (const q of m[1].matchAll(/'([a-z0-9-]+)'/g)) used.add(q[1]);
    }

    // 四、挂了钩子又写内联 style 的元素
    //
    // **只设自定义属性的不算。** `style="--sheet-h:400px"` 喂的是一个变量，
    // 作者照样能用选择器改掉真正那条声明；而 `style="height:400px"` 是
    // 直接写死，谁都盖不住。这两种长得像，后果完全相反。
    if (path.endsWith('.js')) {
      src.split('\n').forEach((line, i) => {
        if (!/\bph-[a-z0-9-]|phc\(/.test(line)) return;
        const at = line.indexOf('style=');
        if (at < 0) return;
        const bad = hardDecls(line.slice(at));
        if (!bad.length) return;
        problems.push(`${path}:${i + 1}  挂了契约钩子又写死了 ${bad.join('、')}，`
          + `作者盖不住它。改成自定义属性或搬进样式表`);
      });
    }
  }

  // 一、登记了没挂
  for (const h of hooks) {
    if (!used.has(h)) problems.push(`${CONTRACT}  登记了 ph-${h}，但源码里没有一处挂着它`);
  }
  // 二、挂了没登记
  for (const u of used) {
    if (!hooks.has(u)) problems.push(`源码里出现 ph-${u}，但 ${CONTRACT} 里没有这一条`);
  }

  // 三、公开变量必须真的有人读。
  //
  // 多数在 tokens.css 里接到内部令牌上；也有直接写在某条规则的 var() 链里的
  // （头像尺寸就是，它只管会话里那一层）。两种都算，所以扫的是全部样式表。
  const styles = sources(['.css']).map(read).join('\n');
  for (const v of vars) {
    if (!styles.includes(`var(--${v}`)) {
      problems.push(`styles/  没有一处读 --${v}，作者写了也不生效`);
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('美化契约', check()));
}
