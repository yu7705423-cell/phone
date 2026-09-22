import { html, useState } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Page, List, ListItem, Segmented, Button, Icon, toast } from '../../ui/index.js';

const { skin, nav } = phone;

// 给作者看的那一页。见 ARCHITECTURE 4.136
//
// 这一页的用处只有一个：**让不装这个应用的人也能写出一份能用的美化。**
// 他需要的东西就三样 —— 有哪些类名、有哪些变量、哪些地方够不着。
// 三样都从 `skin-contract.js` 那张表生成，不另抄一份。
//
// 「复制整份说明」给的是 Markdown，贴到哪儿都读得了；
// 「复制一份骨架」给的是一段带注释的 CSS，改几个值就是一份能用的美化。

const TABS = [
  { value: 'hooks', label: '类名' },
  { value: 'vars', label: '变量' },
  { value: 'how', label: '怎么写' },
];

const scopeLabel = ids => ids
  .map(id => skin.SCOPES.find(s => s.id === id)?.label || id).join('、');

/** 整份说明的 Markdown。作者拿去贴在自己的仓库里。 */
function markdown() {
  const L = [];
  L.push(`# 小手机美化契约 v${skin.CONTRACT_VERSION}`);
  L.push('');
  L.push('一份美化就是一段 CSS，加上一点说明。下面这些名字一经发布不再改动，');
  L.push('照着写即可。内部类名不在此列，随时会变，不要依赖。');
  L.push('');
  L.push('## 两档范围');
  L.push('');
  skin.SCOPES.forEach(s => L.push(`- **${s.label}**（\`${s.id}\`）：${s.desc}`));
  L.push('');
  L.push('## 类名');
  L.push('');
  L.push('| 类名 | 是什么 | 范围 | 条件 |');
  L.push('|---|---|---|---|');
  skin.HOOKS.forEach(h => L.push(
    `| \`.ph-${h.hook}\` | ${h.label}${h.note ? '。' + h.note : ''} | ${scopeLabel(h.on)} | ${h.needs || '始终存在'} |`));
  L.push('');
  L.push('## 变量');
  L.push('');
  L.push('| 变量 | 是什么 | 默认值 | 范围 |');
  L.push('|---|---|---|---|');
  skin.VARS.forEach(v => L.push(
    `| \`--${v.name}\` | ${v.label}${v.note ? '。' + v.note : ''} | ${v.def}${v.unit} | ${scopeLabel(v.on)} |`));
  L.push('');
  L.push('## 几条规矩');
  L.push('');
  L.push('1. 不必写 `!important`。美化那段样式挂在最后，同样特异度下它胜出。');
  L.push('2. 写死尺寸之前先看变量表。改变量比改选择器稳，界面改版也跟得上。');
  L.push('3. 图片写成 `data:` 或者一个公网地址。本机路径在别人那里是空白。');
  L.push('4. 用 `::before` 与 `::after` 贴装饰时记得 `pointer-events: none`，');
  L.push('   否则它会挡住底下的点击。');
  L.push('');
  return L.join('\n');
}

/** 一份能直接改的骨架。 */
function skeleton() {
  return `/* 一份美化的骨架。改掉数值即可，不需要的整段删掉。 */

/* 尺寸走变量，界面改版也跟得上 */
:root {
  --ph-bubble-r: 18px;
  --ph-bubble-px: 14px;
  --ph-bubble-fs: 15px;
  --ph-avatar-r: 50%;
}

/* 角色的气泡 */
.ph-bubble-theirs {
  background: #f3efe8;
  color: #2b2724;
}

/* 我的气泡 */
.ph-bubble-mine {
  background: #2b2724;
  color: #f7f4ef;
}

/* 头像框。图中间要是透明的，否则会把头像盖住 */
.ph-face { position: relative; }
.ph-face::after {
  content: '';
  position: absolute; left: 50%; top: 50%;
  width: 160%; height: 160%;
  transform: translate(-50%, -50%);
  background: url("data:image/png;base64,...") center/contain no-repeat;
  pointer-events: none;
}

/* 顶栏与底栏 */
.ph-navbar { background: transparent; }
.ph-composer { background: #f7f4ef; }
.ph-send { background: #2b2724; }
`;
}

const copy = (text, what) => {
  navigator.clipboard?.writeText(text);
  toast(`已复制${what}`, 'ok');
};

export function ContractPage() {
  const [tab, setTab] = useState('hooks');

  return html`
    <${Page} title="写给作者" onBack=${nav.pop}>
      <div class="settings-foot">
        下面这些名字一经发布不再改动。外部编写的美化只需针对它们，
        应用内部的类名随时可能变化，不要依赖。当前契约版本 ${skin.CONTRACT_VERSION}。
      </div>

      <div class="pad-x">
        <${Segmented} value=${tab} onChange=${setTab} items=${TABS}/>
      </div>

      ${tab === 'hooks' ? html`
        ${skin.SCOPES.map(sc => html`
          <${List} key=${sc.id} title=${sc.label}>
            ${skin.HOOKS.filter(h => h.on[0] === sc.id).map(h => html`
              <${ListItem} key=${h.hook} title=${`.ph-${h.hook}`} multiline
                subtitle=${`${h.label}${h.note ? '。' + h.note : ''}`
    + `${h.needs ? `。需要${h.needs}` : ''}`}
                right=${html`<${Icon} name="copy" size=${16}/>`}
                onClick=${() => copy(`.ph-${h.hook}`, '类名')}/>`)}
          <//>`)}` : null}

      ${tab === 'vars' ? html`
        <${List} title=${`共 ${skin.VARS.length} 项`}>
          ${skin.VARS.map(v => html`
            <${ListItem} key=${v.name} title=${`--${v.name}`} multiline
              subtitle=${`${v.label}${v.note ? '。' + v.note : ''}。默认 ${v.def}${v.unit}`}
              right=${html`<${Icon} name="copy" size=${16}/>`}
              onClick=${() => copy(`--${v.name}`, '变量名')}/>`)}
        <//>
        <div class="settings-foot">
          改变量比改选择器稳。界面改版时选择器可能失效，变量不会。
        </div>` : null}

      ${tab === 'how' ? html`
        <${List} title="几条规矩">
          <${ListItem} title="不必写 !important" multiline
            subtitle="美化那段样式挂在最后，同样特异度下它胜出。写了也不会更保险，
              只会让后面想覆盖它的人无从下手"/>
          <${ListItem} title="写死尺寸之前先看变量表" multiline
            subtitle="变量在界面改版时仍然有效，选择器可能失效"/>
          <${ListItem} title="图片写成 data: 或公网地址" multiline
            subtitle="本机路径在别人那里显示为空白。写了公网地址，对方每次打开都会向其发起请求"/>
          <${ListItem} title="贴装饰记得 pointer-events: none" multiline
            subtitle="用 ::before 与 ::after 贴上去的东西会挡住底下的点击"/>
          <${ListItem} title="声明范围" multiline
            subtitle="美化包里的 scope 决定它挂在哪一层。只写会话的不会影响主界面，
              也不需要用户额外确认"/>
        <//>` : null}

      <div class="pad">
        <${Button} full variant="ghost" icon="copy"
          onClick=${() => copy(markdown(), '整份说明')}>复制整份说明<//>
      </div>
      <div class="pad-x pad-b">
        <${Button} full variant="ghost" icon="copy"
          onClick=${() => copy(skeleton(), '骨架')}>复制一份 CSS 骨架<//>
      </div>
    <//>`;
}
