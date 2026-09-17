import { sources, read, rel, report } from './lib.mjs';

// 只用 vh,禁止 dvh / svh / lvh。见 CLAUDE.md 第 1 条
// 外壳那一串容器必须整整齐齐都是 100vh,其余地方一个视口单位都不许有。
const BANNED = /\b\d*\.?\d+(dvh|svh|lvh|dvw|svw|lvw)\b/;
const VP = /\b\d*\.?\d+vh\b/;

// 允许出现视口单位的地方:只有最外层这四个容器,而且必须是 100vh
const SHELL = new Set(['styles/base.css']);
const SHELL_SELECTORS = ['html, body', '#app', '.root'];

export function check() {
  const problems = [];
  const shellHits = [];

  for (const file of sources(['.css', '.js', '.html'])) {
    read(file).split('\n').forEach((line, i) => {
      if (line.includes('CLAUDE.md') || /^\s*(\/\*|\*|\/\/)/.test(line)) return;
      const bad = line.match(BANNED);
      if (bad) problems.push(`${rel(file)}:${i + 1}  用了 ${bad[1]}，只允许 vh`);
      if (!VP.test(line)) return;
      if (!SHELL.has(rel(file))) {
        problems.push(`${rel(file)}:${i + 1}  视口单位只允许出现在外壳容器上：${line.trim()}`);
        return;
      }
      if (!/\b100vh\b/.test(line)) {
        problems.push(`${rel(file)}:${i + 1}  外壳只能是 100vh，不能是别的值：${line.trim()}`);
        return;
      }
      shellHits.push(rel(file) + ':' + (i + 1));
    });
  }

  // 外壳那几层必须全都写了,少一层就会只撑到可视区、撑不到屏幕底。
  // 先把注释剥掉,否则注释里提到的选择器会把规则匹配歪。
  const base = [...sources(['.css'])].find(f => rel(f) === 'styles/base.css');
  const css = (base ? read(base) : '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of SHELL_SELECTORS) {
    const re = new RegExp('^\\s*' + sel.replace(/[.#*+?^${}()|[\]\\]/g, '\\$&') +
      '\\s*\\{[^}]*height:\\s*100vh', 'm');
    if (!re.test(css)) {
      problems.push(`styles/base.css  ${sel} 没有写 height: 100vh。外壳这一串必须统一，见 CLAUDE.md 第 1 条`);
    }
  }
  if (!problems.length && !shellHits.length) {
    problems.push('一处视口单位都没有，外壳撑不起来');
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('视口单位', check()));
}
