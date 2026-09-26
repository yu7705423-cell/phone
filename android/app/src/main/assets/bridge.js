// 安卓外壳在每个页面一开始注入的脚本（MainActivity 里 addDocumentStartJavaScript）。
//
// 网页那一侧是照着 iOS 外壳写的：window.webkit.messageHandlers.net.postMessage(...) 回一个 Promise。
// 这里用同样的名字、同样的形状，底下接到 Kotlin 的 EiraNative 上 —— 网页一行都不用为安卓改。
//
// 另外接住下载：网页导出备份用的是 <a download href="blob:..."> 再 click()，
// 安卓的 WebView 不认 blob: 下载，这里把内容分块交给外壳写进「下载」。
//
// 只在应用自己的主页面里装（见 ARCHITECTURE 4.249）。EiraNative 这个对象安卓会注入进**每一个** frame，
// 沙盒里的网页（工具箱网页工具、主屏组件）也拿得到。所以外壳的每个接口都要带一个口令，
// 口令只写在这份脚本里，而这份脚本在子 frame 里一行都不跑，沙盒里的网页拿不到口令，调了也被拒。
// 网页那一侧一律经 window.EiraShell 调；认不出 phoneFrameGuard 的旧外壳，沙盒里不给运行脚本（system/sandbox.js）。
(function () {
  if (window.top !== window) return;
  if (window.__eiraShell) return;
  var N = window.EiraNative;
  if (!N) return;
  window.__eiraShell = true;
  var T = '__EIRA_TOKEN__';
  window.phoneFrameGuard = true;
  window.EiraShell = {
    version: function () { return N.version(T); },
    exitApp: function () { return N.exitApp(T); },
    floatAllowed: function () { return N.floatAllowed(T); },
    askFloat: function () { return N.askFloat(T); },
    setFloat: function (json) { return N.setFloat(T, json); },
    setSystemBars: function (show) { return N.setSystemBars(T, show); },
  };

  var pending = {};
  var seq = 0;
  // 外壳干完活回调这里
  window.__eiraReply = function (id, json) {
    var done = pending[id];
    if (!done) return;
    delete pending[id];
    try { done(JSON.parse(json)); } catch (e) { done({ error: String(e) }); }
  };
  function handler(name) {
    return {
      postMessage: function (msg) {
        return new Promise(function (resolve) {
          var id = ++seq;
          pending[id] = resolve;
          N.post(T, name, id, JSON.stringify(msg || {}));
        });
      },
    };
  }

  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = window.webkit.messageHandlers || {};
  // 替网页发请求，绕开跨域（见 system/net.js 与 ios/Sources/NetBridge.swift）
  window.webkit.messageHandlers.net = handler('net');
  window.phoneNet = { timeout: true };
  // 返回交给安卓的返回键与系统手势（见 shell/goback.js），网页自己那套边缘手势让开
  window.phoneNativeBack = true;
  window.phoneAppVersion = 'Android ' + N.version(T);
  // 系统状态栏藏起来了（MainActivity），网页自己画一条（见 shell/StatusBar.js）
  window.phoneFullscreen = true;

  // ---- 下载 ----
  var CHUNK = 512 * 1024;
  function b64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function save(href, name) {
    try {
      var blob = await (await fetch(href)).blob();
      var id = N.beginSave(T, name || 'download', blob.type || 'application/octet-stream');
      if (!id) return;
      for (var at = 0; at < blob.size; at += CHUNK) {
        var part = new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer());
        if (!N.appendSave(T, id, b64(part))) return;
      }
      N.endSave(T, id);
    } catch (e) {
      N.saveFailed(T, String(e && e.message || e));
    }
  }
  function wants(a) {
    return a && a.hasAttribute && a.hasAttribute('download') && /^(blob:|data:)/.test(a.href || '');
  }
  // 网页常见的写法是新建一个 <a>、不放进页面就 click()：这种点击不会冒泡到 document，
  // 只能在 click 本身上接
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (wants(this)) { save(this.href, this.getAttribute('download')); return; }
    return click.apply(this, arguments);
  };
  // 放进页面、由人点的那种
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (!wants(a)) return;
    e.preventDefault();
    e.stopPropagation();
    save(a.href, a.getAttribute('download'));
  }, true);
})();
