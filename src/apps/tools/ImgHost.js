import { html, useState } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Page, Markdown, Field, Input, Button, toast } from '../../ui/index.js';

const { nav } = phone;

// 图床搭建教程。只做说明，Eira 不替用户上传（用户要求）。
//
// 为什么要图床：Eira 的图片存在本设备，别人看不见。美化包里想带图、应用图标想用同一张图，
// 图片要放在一个公开可访问的地址上。本页讲两种不花钱、不绑卡的做法，都落在 Cloudflare Pages ——
// 与后台消息服务器同一个账号，用户多半已经注册过。

const GUIDE = `## 图床的用途

Eira 中的图片保存在本设备，只有本机可见。以下情况需要把图片放在公开地址上：

- 分享美化包时，包中以地址引用的图片需对方也能打开
- 应用图标、书架封面等处选择「图片地址」时

公开地址上的图片任何人都可以访问。**请勿上传私人照片。**

## 方案一：直接上传（无需 GitHub）

适合图片不多、偶尔更新的情况。

1. 注册并登录 Cloudflare（与后台消息服务器可用同一个账号）。
2. 进入「Workers 和 Pages」（Workers & Pages），点「创建」，选择 Pages 下的「上传资产」（Upload assets）。
3. 填写项目名称，例如 \`my-images\`。项目名称会成为网址的一部分。
4. 在电脑上新建一个文件夹，放入要上传的图片，将整个文件夹拖入上传区域，点「部署」。
5. 部署完成后，图片地址为 \`https://项目名称.pages.dev/文件名\`，例如 \`https://my-images.pages.dev/bg.png\`。

**更新图片**：在该项目中点「创建新部署」，上传**完整的**文件夹。新部署会替换上一次的全部文件，未包含在内的图片地址将失效。

## 方案二：GitHub 仓库自动部署

适合经常增加图片的情况。增加图片时只需在 GitHub 网页上传，无需重新上传整个文件夹。

1. 在 GitHub 新建一个公开仓库，例如 \`my-images\`。
2. 在仓库页面点「Add file」中的「Upload files」，上传图片并提交。
3. 在 Cloudflare 的「Workers 和 Pages」中点「创建」，选择 Pages 下的「连接到 Git」，授权并选择该仓库。
4. 构建设置全部留空（没有构建命令，输出目录为根目录），点「保存并部署」。
5. 此后每次向仓库上传图片，Cloudflare 自动重新部署，地址格式与方案一相同。

## 文件命名

- 文件名使用英文字母、数字、短横线与下划线，不使用空格与中文，否则地址需要转码，容易出错。
- 单个文件不超过 25 MB。
- 放在子文件夹中的图片，地址中需包含文件夹名，例如 \`https://my-images.pages.dev/icons/chat.png\`。

## 在 Eira 中使用

- **美化**：在 CSS 中写 \`url("https://my-images.pages.dev/bg.png")\`。
- **应用图标**：主界面长按图标，选择「图片地址」并粘贴地址。
- 使用前可在本页下方「检查地址」中确认图片能否打开。

## 常见问题

- **部分网络下打不开**：\`pages.dev\` 在部分地区访问不稳定。可在该项目的「自定义域」中绑定自己的域名。
- **删除图片之后**：已经分享出去的美化包中引用该图片的位置将显示为空白。
- **改了图片地址却没变化**：浏览器可能仍在使用旧图的缓存。更换文件名，或在地址末尾加 \`?v=2\`。`;

export function ImgHostPage() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState(''); // '' | 'loading' | 'ok' | 'bad'
  const [shown, setShown] = useState('');

  const check = () => {
    const u = url.trim();
    if (!/^https:\/\//i.test(u)) { toast('请填写以 https:// 开头的地址'); return; }
    setShown(u); setState('loading');
  };

  return html`
    <${Page} title="图床搭建教程" onBack=${nav.pop}>
      <div class="pad-x pad-b">
        <${Markdown} text=${GUIDE}/>
      </div>
      <div class="pad">
        <${Field} label="检查地址" desc="粘贴图片地址，确认能否在本设备打开。能打开不代表所有网络都能打开。">
          <${Input} value=${url} placeholder="https://" onInput=${v => { setUrl(v); setState(''); }}/>
        <//>
        <${Button} full variant="ghost" onClick=${check}>检查<//>
        ${shown && state ? html`
          <div class="tb-img-check">
            <img src=${shown} alt="" onLoad=${() => setState('ok')} onError=${() => setState('bad')}
              class=${state === 'ok' ? '' : 'is-hidden'}/>
            <div class="tb-call">${state === 'loading' ? '正在加载' : state === 'ok' ? '图片可以打开' : '无法打开该地址，请检查地址是否正确、是否已部署完成'}</div>
          </div>` : null}
      </div>
    <//>`;
}
