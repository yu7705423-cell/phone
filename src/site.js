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
  neteaseWorker: 'https://phone-netease.yu864249.workers.dev',
  // 登录账号服务的地址。通常就是上面那个 Worker（它同时管登录，见 worker/README.md「登录账号」）。
  // 填了、而且那边开了账号功能，应用一打开就要登录；那边还没开时照常放行。留空表示不要登录
  accounts: 'https://phone-netease.yu864249.workers.dev',
  // 换网址（搬家，见 ARCHITECTURE 4.220）。两个都填完整网址，以 / 结尾，例如
  //   moveFrom: 'https://yu7705423-cell.github.io/phone/'   旧网址
  //   moveTo:   'https://eira.example.cn/'                   新网址
  // 两个都填了，旧网址上会提示搬家，新网址上可以一键把旧网址的数据搬过来。
  // 浏览器里的数据按网址分开存，不搬的话新网址上是空的。留空表示没有搬家这回事
  moveFrom: 'https://yu7705423-cell.github.io/phone/',
  moveTo: 'https://eiraphone.cn/',
};
