import { sources, read, rel, report } from './lib.mjs';

// hooks 必须每次渲染都以相同顺序调用。
// 在提前 return 之后再调 hook，组件关闭再打开时 hook 数量就对不上，
// 表现为状态串味或界面不刷新——这种错不报异常，只会安静地出怪事。
const FN_START = /(?:^|\s)function\s+([A-Z]\w*)\s*\(/;
const IF_RETURN = /^\s*if\s*\([^]*\)\s*(?:\{\s*)?return\b/;
const BARE_RETURN = /^\s*return\b/;

// 只认真正的 hook，避免把 useImageFile 这类普通函数算进来
const HOOKS = [
  'useState', 'useReducer', 'useEffect', 'useLayoutEffect', 'useRef',
  'useMemo', 'useCallback', 'useContext', 'useErrorBoundary', 'useImperativeHandle',
  'useStore', 'useImage', 'usePhone',
];
const HOOK_RE = new RegExp(`\\b(${HOOKS.join('|')})\\s*\\(`);

export function check() {
  const problems = [];

  for (const file of sources(['.js'])) {
    const lines = read(file).split('\n');
    let fn = null, depth = 0, sawReturn = 0;

    lines.forEach((line, i) => {
      const startsFn = FN_START.test(line);
      if (startsFn) {
        fn = line.match(FN_START)[1];
        depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        sawReturn = 0;
        return;                       // 这一行本身不算提前返回
      }
      if (!fn) return;

      const before = depth;
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

      if (before <= 1 && (IF_RETURN.test(line) || BARE_RETURN.test(line))) {
        if (!sawReturn) sawReturn = i + 1;
      }

      if (sawReturn && HOOK_RE.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) {
        problems.push(`${rel(file)}:${i + 1}  组件 ${fn} 在第 ${sawReturn} 行提前返回之后才调用 hook`);
        sawReturn = 0;
      }

      if (depth <= 0) fn = null;
    });
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('hook 顺序', check()));
}
