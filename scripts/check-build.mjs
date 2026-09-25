import { read, ROOT } from './lib.mjs';

// index.html 里的构建号必须和 src/version.js 对得上。
//
// 这两处对不上不会报错，只会让 main.js 每次启动都以为缓存旧了，
// 于是无限自愈重开；或者反过来，真旧了却检测不出来。
export function check() {
  const html = read(`${ROOT}/index.html`);
  const js = read(`${ROOT}/src/version.js`);

  const meta = html.match(/<meta\s+name="build"\s+content="([^"]*)"/);
  const build = js.match(/BUILD\s*=\s*'([^']*)'/);

  if (!meta) return ['index.html 里少了 <meta name="build" content="...">'];
  if (!build) return ["src/version.js 里没找到 export const BUILD = '...'"];
  if (meta[1] !== build[1]) {
    return [`构建号对不上：index.html 是 ${meta[1]}，src/version.js 是 ${build[1]}。两处要一起改`];
  }
  // 样式表的地址带着同一个构建号：页面每次都是新的，样式表跟着它换，
  // 不会出现新代码配上一版样式表（ARCHITECTURE 4.230）
  const problems = [];
  const links = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="(styles\/[^"]+)"/g)].map(m => m[1]);
  if (!links.length) problems.push('index.html 里一张样式表都没找到');
  links.forEach(href => {
    const v = href.match(/\?v=([^&"]*)/);
    if (!v) problems.push(`index.html 的 ${href} 没带 ?v=构建号`);
    else if (v[1] !== meta[1]) problems.push(`index.html 的 ${href} 带的是 ${v[1]}，页面是 ${meta[1]}。一起改`);
  });
  return problems;
}
