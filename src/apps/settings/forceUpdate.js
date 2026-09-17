// 无构建方案没有文件指纹,浏览器会把 .js/.css 一直留在 HTTP 缓存里。
// 手机上经常是代码早推上去了、屏幕上还是旧界面。
// 这里把本页实际加载过的同源 js/css 全部用 cache:'reload' 重新取一遍,
// 顺手覆盖掉缓存条目,再刷新页面就一定是新的。
export async function forceUpdate() {
  const urls = new Set([location.href.split('#')[0]]);
  performance.getEntriesByType('resource').forEach(e => {
    if (e.name.startsWith(location.origin) && /\.(m?js|css)(\?|$)/.test(e.name)) urls.add(e.name);
  });

  // 顺便清掉 Cache Storage,以后真加了 service worker 也不会拖后腿
  if (window.caches) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch { /* 私密模式下会抛,不影响下面 */ }
  }

  let ok = 0, fail = 0;
  await Promise.all([...urls].map(u =>
    fetch(u, { cache: 'reload' }).then(r => { r.ok ? ok++ : fail++; }, () => fail++)));
  return { total: urls.size, ok, fail };
}
