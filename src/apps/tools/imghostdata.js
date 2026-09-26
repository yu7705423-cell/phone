// 图床的搭建向导：每一家怎么注册、去哪里拿什么、拿回来填在哪。见 ARCHITECTURE 4.248
//
// 内容来自用户的「图床搬家工具」（changephoto）的搭建向导，改写成本项目的书面语。
// 每一步：说明、可以点击跳转的链接、需要复制的代码、拿回来直接填的输入框（用户要求）。
// 填的东西随手存成草稿，跳出去复制再回来还在；最后一步测试连接，通过后存进「我的图床」。

export const SETUP = {
  github: {
    name: 'GitHub + jsDelivr',
    desc: '免费，无需绑卡。图片作为文件提交到公开仓库，经 jsDelivr 加速',
    tag: '国内访问可能不稳定',
    lead: '适合长期存放可以公开的图片。仓库属于自己，服务方停止运营后图片仍在。',
    steps: [
      { title: '注册或登录 GitHub',
        text: '没有账号请先注册。用户名是个人主页地址中 github.com/ 之后的那一段。',
        links: [{ href: 'https://github.com/join', label: '注册' }, { href: 'https://github.com/login', label: '登录' }],
        fields: [{ key: 'owner', label: 'GitHub 用户名', placeholder: '例如 octocat' }] },
      { title: '新建一个公开仓库',
        text: '创建时勾选「Add a README file」。可见性必须选择 Public，私有仓库 jsDelivr 无法读取。分支名不确定时填写 main。',
        links: [{ href: 'https://github.com/new', label: '新建仓库' }],
        fields: [
          { key: 'repo', label: '仓库名', placeholder: '例如 image-host' },
          { key: 'branch', label: '分支名', placeholder: 'main', value: 'main' },
          { key: 'dir', label: '存放目录', placeholder: 'images', value: 'images' },
        ] },
      { title: '生成 Personal Access Token',
        text: '用于让 Eira 代为把图片提交进仓库。',
        links: [{ href: 'https://github.com/settings/tokens/new', label: '生成 Token（classic）' }],
        note: '权限范围只需勾选 repo，有效期可选择 No expiration。Token 只完整显示一次，生成后请立即复制并粘贴到下方。',
        fields: [
          { key: 'token', label: 'Token', placeholder: 'ghp_ 或 github_pat_ 开头', type: 'password' },
          { key: 'linkStyle', label: '生成链接', type: 'select', value: 'jsdelivr', options: [
            { value: 'jsdelivr', label: 'jsDelivr' }, { value: 'statically', label: 'Statically' }, { value: 'raw', label: 'raw' }] },
        ] },
    ],
    warn: 'jsDelivr 在国内部分网络下访问不稳定，图片可能间歇性加载失败。可以把「生成链接」改为 Statically 或 raw。',
  },

  imgbb: {
    name: 'ImgBB',
    desc: '免费图床，注册后即可使用，无需部署',
    tag: '最省事',
    lead: '适合快速上传。官方没有标准的删除接口，上传后不便删除。',
    steps: [
      { title: '注册或登录 ImgBB',
        links: [{ href: 'https://imgbb.com/signup', label: '注册' }, { href: 'https://imgbb.com/login', label: '登录' }] },
      { title: '获取 API Key',
        text: '登录后打开 API 页面，点「Get API key」，复制显示的密钥。',
        links: [{ href: 'https://api.imgbb.com/', label: '获取 API Key' }],
        fields: [
          { key: 'key', label: 'API Key', placeholder: '粘贴到这里', type: 'password' },
          { key: 'expiration', label: '自动删除', type: 'select', value: '', options: [
            { value: '', label: '永久保存' }, { value: '2592000', label: '30 天后' }, { value: '604800', label: '7 天后' }] },
        ] },
    ],
    warn: 'ImgBB 没有标准的删除接口。上传记录中保存了删除链接，需要删除时打开该链接手动确认。',
  },

  smms: {
    name: 'S.EE（原 SM.MS）',
    desc: 'SM.MS 已迁至 s.ee，接口兼容原 v2 接口',
    tag: '新用户需购买套餐',
    lead: '老牌图床，可以直接上传。服务形态有过变化，不建议存放不能丢失的图片。',
    steps: [
      { title: '注册或登录 S.EE',
        text: '老用户直接登录；新用户注册后需开通付费套餐才能上传。',
        links: [{ href: 'https://s.ee/register', label: '注册' }, { href: 'https://s.ee/login', label: '登录' }],
        warn: '原 sm.ms 的账号与图片已迁移到 s.ee，但密码没有一同迁移，老用户需用原邮箱重设密码。s.ee 不再开放免费注册。' },
      { title: '获取 API Token',
        text: '登录后进入控制台的 API Token 页面，复制显示的 Token。原 sm.ms 的旧 Token 迁移后可能失效，建议重新生成。',
        links: [{ href: 'https://s.ee/user/dashboard/', label: '获取 Token' },
          { href: 'https://s.ee/docs/developers/smms-compatibility/', label: '兼容说明' }],
        fields: [
          { key: 'token', label: 'API Token', placeholder: '粘贴到这里', type: 'password' },
          { key: 'base', label: '接口域名', type: 'select', value: 'https://s.ee', options: [
            { value: 'https://s.ee', label: 's.ee' }, { value: 'https://sm.ms', label: 'sm.ms' }] },
          { key: 'viaRelay', label: '通过中转 Worker 上传（出现跨域错误时开启）', type: 'switch' },
        ] },
    ],
    warn: '公共图床有过限流与清理图片的情况。单张上限 5 MB，每分钟最多 20 张，连续上传时会自动放慢。',
  },

  r2: {
    name: 'Cloudflare R2',
    desc: '10 GB 免费空间，出口流量免费。需要绑定支付方式并部署一个 Worker',
    tag: '需要绑卡',
    lead: '最耐用的一种，需要多花约十分钟。这个 Worker 同时负责两件事：接收上传到 R2 的图片，'
      + '以及在图床搬家时代为取回旧图床的图片（绕开跨域与防盗链）。',
    steps: [
      { title: '注册 Cloudflare 并启用 R2',
        text: '注册后进入控制台左侧的 R2 Object Storage，按提示绑定支付方式后启用。',
        links: [{ href: 'https://dash.cloudflare.com/sign-up', label: '注册 Cloudflare' },
          { href: 'https://dash.cloudflare.com/?to=/:account/r2', label: '启用 R2' }],
        warn: '启用 R2 须绑定信用卡或 PayPal 用于身份验证。免费额度内（10 GB 存储、每月 100 万次写入、1000 万次读取）不扣费，'
          + '超出后按量计费。不希望绑卡时，请改选 GitHub 或 ImgBB。' },
      { title: '创建存储桶并开启公开访问',
        text: '名称自定，例如 image-host。创建后进入存储桶的 Settings，在 Public access 中开启，'
          + '会得到形如 https://pub-xxxx.r2.dev 的公开域名，填写到下方。也可以绑定自己的域名。',
        links: [{ href: 'https://dash.cloudflare.com/?to=/:account/r2', label: '打开 R2 控制台' }],
        fields: [
          { key: 'publicBase', label: '公开访问域名', placeholder: 'https://pub-xxxx.r2.dev' },
          { key: 'dir', label: '存放目录', placeholder: 'images', value: 'images' },
        ] },
      { title: '部署 Worker',
        text: '控制台左侧 Workers & Pages，依次点 Create、Start with Hello World!、Deploy。部署后点 Edit code，'
          + '把下方代码整段替换进去，再点 Deploy。',
        links: [{ href: 'https://dash.cloudflare.com/?to=/:account/workers-and-pages', label: '打开 Workers & Pages' }],
        code: 'worker',
        note: '然后在这个 Worker 的 Settings 中完成三项：Variables and Secrets 中添加 ACCESS_TOKEN，值为自己设定的一串口令'
          + '（务必设置，否则他人知道地址即可使用你的额度）；Bindings 中添加 R2 bucket，变量名必须为 BUCKET，选择上一步的存储桶；'
          + 'Variables and Secrets 中再添加 PUBLIC_BASE，值为上一步的公开域名。',
        fields: [
          { key: '_relayUrl', label: 'Worker 地址', placeholder: 'https://xxx.workers.dev' },
          { key: '_relayToken', label: 'ACCESS_TOKEN', placeholder: '与 Worker 中设置的一致', type: 'password' },
        ] },
    ],
    warn: '这个 Worker 同时作为中转：测试通过后，图床搬家时取回跨域或防盗链的图片也一并可用。',
  },

  custom: {
    name: '自定义接口',
    desc: '兰空图床、Chevereto 或自建的上传接口',
    tag: '按文档填写',
    lead: '按自己图床的文档填写。以兰空图床 V2 为例：接口为 https://你的域名/api/v1/upload，字段名 file，'
      + 'Authorization 填写 Bearer 加令牌，链接字段为 data.links.url。',
    steps: [
      { title: '填写接口',
        fields: [
          { key: 'endpoint', label: '接口地址', placeholder: 'https://your-host/api/v1/upload' },
          { key: 'field', label: '文件字段名', placeholder: 'file', value: 'file' },
          { key: 'auth', label: 'Authorization', placeholder: 'Bearer xxxxxx，没有可留空', type: 'password' },
          { key: 'jsonPath', label: '返回内容中链接的字段路径', placeholder: 'data.links.url', value: 'data.links.url' },
          { key: 'viaRelay', label: '通过中转 Worker 上传（出现跨域错误时开启）', type: 'switch' },
        ] },
    ],
    warn: '测试连接时会上传一张 1×1 的测试图片，确认能取回链接。',
  },

  relay: {
    name: '中转 Worker',
    desc: '可选。搬家时代为取回跨域或防盗链的图片；S.EE 与自定义接口出现跨域错误时代为上传',
    tag: '可选',
    lead: '浏览器直接读取别人服务器上的图片，常被跨域限制或防盗链拦下。Worker 在 Cloudflare 的服务器上取图，'
      + '两道限制都能绕开。免费额度每天 10 万次请求。已按 Cloudflare R2 的步骤部署过 Worker 的，无需重复部署。',
    steps: [
      { title: '部署 Worker',
        text: '注册并登录 Cloudflare，控制台左侧 Workers & Pages，依次点 Create、Start with Hello World!、Deploy。'
          + '部署后点 Edit code，把下方代码整段替换进去，再点 Deploy。',
        links: [{ href: 'https://dash.cloudflare.com/sign-up', label: '注册 Cloudflare' },
          { href: 'https://dash.cloudflare.com/?to=/:account/workers-and-pages', label: '打开 Workers & Pages' }],
        code: 'worker' },
      { title: '设置口令',
        text: '在这个 Worker 的 Settings 中，Variables and Secrets 添加 ACCESS_TOKEN，值为自己设定的一串口令。'
          + '务必设置，否则他人知道地址即可使用你的额度。',
        fields: [
          { key: 'url', label: 'Worker 地址', placeholder: 'https://xxx.workers.dev' },
          { key: 'token', label: 'ACCESS_TOKEN', placeholder: '与 Worker 中设置的一致', type: 'password' },
        ] },
    ],
  },
};

export const HOST_TYPES = ['github', 'imgbb', 'smms', 'r2', 'custom'];

/** 某一家要填的全部字段，按步骤顺序摊平（「我的图床」里改配置时用） */
export const fieldsOf = type => (SETUP[type]?.steps || []).flatMap(s => s.fields || []);
