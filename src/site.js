// 本站的默认设置。**给运营这个应用的人填，不是给用户填的。**
//
// 用户多半不懂技术、也没有任何平台的账号，让他们自己去部署一个网易云接口是做不到的。
// 所以由运营方部署一个，写在这里：用户什么都不填就用它，想用自己的可以在
// 「设置 - 音乐服务」里改填，改填的优先。
//
// 安全上这不多出一方：用户是从本站打开这个应用的，应用的代码本来就由本站提供，
// 本来就完全信任本站。这和让用户去填一个陌生人开的公共实例是两回事。
//
// 部署方法见 ARCHITECTURE.md 4.184；没有服务器时用下面的 neteaseWorker，步骤见 worker/README.md。改了这里要同时改构建号（CLAUDE.md「提交前自检」）。
export const SITE = {
  // 网易云接口（NeteaseCloudMusicApi 或其分支）的地址，填到端口为止，例如 https://music-api.example.com
  // 留空表示本站不提供，用户须自己填写
  neteaseApi: '',
  // 接口部署在境外时，网易云常按出口 IP 拦截（-462）。填一个中国大陆 IP 可以绕开；部署在国内就留空。
  // 用下面的 Worker 时不必填：每台设备会自己固定一个随机的国内 IP
  neteaseRealIP: '',
  // 本站的网易云转发 Worker（worker/netease.js 部署到 Cloudflare 之后的地址），例如 https://ne.xxx.workers.dev
  // 没有服务器时用它。和上面的 neteaseApi 二选一，两个都填时用 neteaseApi
  neteaseWorker: '',
};
