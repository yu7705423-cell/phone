// 把代码存在本机（sw.js 的缓存那一半，ARCHITECTURE 4.220）。
//
// 注册地址带着构建号：sw.js?b=<index.html 里 meta 写的那个>。构建号一变地址就变，
// 浏览器装一个新的 Service Worker，旧的那份缓存整份删掉 —— 不会新旧混着。
// 通知那边（push.js）注册的也必须是同一个地址，两处地址不一样，会互相把对方换掉。
//
// 自动化测试里默认不缓存（地址带 cache=0）：好几个测试靠拦截本站的 js 来造场景
// （改 site.js、拖慢 main.js、换 version.js），缓存接管之后那些拦截就失效了。
// 专门测缓存的那一个在 localStorage 里放 eira-sw-test 打开它。

const TEST_FLAG = 'eira-sw-test';

const declared = () => document.querySelector('meta[name="build"]')?.content || 'dev';

function cacheOn() {
  if (!navigator.webdriver) return true;
  try { return localStorage.getItem(TEST_FLAG) === '1'; } catch { return false; }
}

export const swUrl = () => `sw.js?b=${encodeURIComponent(declared())}${cacheOn() ? '' : '&cache=0'}`;

export const supported = () => 'serviceWorker' in navigator && location.protocol !== 'file:';

// 这一版（地址对得上）的那个 Service Worker 进入 activated。一分钟还没等到就算了，下次再报
function activeOf(reg, url) {
  const pick = () => [reg.active, reg.waiting, reg.installing].find(w => w && w.scriptURL === url);
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 60000);
    const check = () => {
      const w = pick();
      if (!w) return;
      if (w.state === 'activated') { clearTimeout(t); resolve(w); return; }
      if (w.state === 'redundant') { clearTimeout(t); resolve(null); return; }
      w.addEventListener('statechange', check, { once: true });
    };
    check();
    reg.addEventListener('updatefound', check);
  });
}

/**
 * 启动完调一次：注册（已注册过同一个地址就是原样），再把这一次已经加载过的同源文件报给它补进缓存 ——
 * 第一次打开时它还没接管，那一批没经过它
 */
export async function install() {
  if (!supported()) return null;
  try {
    const url = new URL(swUrl(), location.href).href;
    const reg = await navigator.serviceWorker.register(swUrl());
    // 等**这一版**的那个接管了再报：刚发了新版时，正在管事的还是上一版的那个，
    // 报给它等于往马上要删的那份缓存里补，还会拖着新的那个迟迟激活不了
    const mine = await activeOf(reg, url);
    if (!mine) return reg;
    const urls = performance.getEntriesByType('resource')
      .map(e => e.name).filter(u => u.startsWith(location.origin));
    mine.postMessage({ type: 'warm', urls });
    return reg;
  } catch (err) {
    console.warn('[offline] 没装上', err.message || err);
    return null;
  }
}
