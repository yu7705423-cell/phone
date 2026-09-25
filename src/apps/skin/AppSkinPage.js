import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, Field, Textarea, toast, confirm } from '../../ui/index.js';

const { db, nav, skin } = phone;

// 应用美化：整个应用那一层（scope 含 shell）单独一页。见 ARCHITECTURE 4.229
//
// 会话那一层要先挂到某段会话上才看得见，入口在会话里；应用这一层同一时间只有一份，
// 从前要进一份美化的详情页、打开「整个应用」、再打开「设为全局」三步才生效，
// 而消息列表、联系人、朋友圈、主页那几组类名混在「写给作者」的长表里。
// 这一页把三样放在一处：当前是哪一份、它的样式、能写哪些类名。
//
// **一键恢复默认只取消全局，不删那一份。** 写了半天的样式一下子没了没法找回；
// 取消全局之后它还在美化库里，下面「可启用的美化」点一下就回来。
//
// 编辑时样式实时生效（shell/Root.js 盯着 updatedAt）。写坏了进设置 ——
// 设置页永不注入美化，那里也有总开关。

// 这一页只列应用这一层的几组；气泡、底栏那几组在会话里改，列在「写给作者」
const APP_GROUPS = ['chats', 'contacts', 'moments', 'profile', 'page', 'home'];

export function AppSkinPage() {
  useStore(db.skins.store);
  useStore(db.settings.store);
  const [group, setGroup] = useState(APP_GROUPS[0]);
  const cfg = db.settings.get();
  const row = skin.get(cfg.globalSkinId || '');
  const current = row && skin.isGlobal(row) ? row : null;
  const others = skin.all().filter(r => skin.isGlobal(r) && r.id !== current?.id);

  const create = () => {
    const made = skin.create({ name: '应用美化', scope: ['shell'] });
    skin.setGlobal(made.id);
    toast('已新建并启用', 'ok');
  };

  const reset = async () => {
    if (!await confirm({
      title: '恢复默认样式', okText: '恢复默认',
      message: `整个应用恢复为默认样式。「${current.name}」保留在美化库中，可随时重新启用。`,
    })) return;
    skin.setGlobal('');
    toast('已恢复默认样式', 'ok');
  };

  const copy = hook => {
    navigator.clipboard?.writeText(`.ph-${hook}`);
    toast('已复制类名', 'ok');
  };

  const groups = skin.GROUPS.filter(g => APP_GROUPS.includes(g.id));
  const hooks = skin.HOOKS.filter(h => h.group === group);

  return html`
    <${Page} title="应用美化" onBack=${nav.pop}>
      <div class="settings-foot">
        作用于整个应用：消息列表、联系人、朋友圈、主页、主界面与各页的顶栏。
        同一时间只启用一份。设置页永不注入美化，样式出错时可在设置中关闭。
      </div>
      ${cfg.skinOff === true ? html`
        <div class="settings-foot">「外观」中的美化总开关当前为关闭，此处的样式暂不生效。</div>` : null}

      ${current ? html`
        <${List} title="当前启用">
          <${ListItem} title=${current.name} arrow multiline
            subtitle="生成器、尺寸、导出与改名在这一份的页面里"
            left=${html`<${Icon} name="sparkle" size=${18}/>`}
            onClick=${() => nav.push(`/one/${current.id}`)}/>
          ${skin.crashed(current.id) ? html`
            <${ListItem} title="已暂停注入" multiline
              subtitle="上次启用时页面没能正常显示。确认改好之后点此恢复"
              onClick=${() => { skin.forgive(); toast('已恢复', 'ok'); }}/>` : null}
        <//>
        <div class="pad-x pad-t">
          <${Field} label="样式"
            desc="输入即生效。可用的类名见下方，点一下复制。">
            <${Textarea} rows=${14} value=${current.css || ''}
              placeholder=".ph-chat-row { border-radius: 12px; }"
              onInput=${v => skin.update(current.id, { css: v })}/>
          <//>
        </div>
        <div class="pad">
          <${Button} full variant="ghost" icon="refresh" onClick=${reset}>恢复默认样式<//>
        </div>` : html`
        <${List} title="当前启用">
          <${ListItem} title="默认样式" multiline subtitle="尚未启用任何应用美化"/>
        <//>
        <div class="pad">
          <${Button} full icon="plus" onClick=${create}>新建应用美化<//>
        </div>`}

      ${others.length ? html`
        <${List} title="可启用的美化">
          ${others.map(r => html`
            <${ListItem} key=${r.id} title=${r.name} multiline
              subtitle="启用后替换当前这一份，当前这一份保留在美化库中"
              right=${html`<${Button} size="sm" variant="ghost"
                onClick=${() => { skin.setGlobal(r.id); toast(`已启用「${r.name}」`, 'ok'); }}>启用<//>`}/>`)}
        <//>` : null}

      <div class="pad-x pad-t">
        <div class="chip-row">
          ${groups.map(g => html`
            <button key=${g.id} type="button" class=${`chip press${g.id === group ? ' is-active' : ''}`}
              onClick=${() => setGroup(g.id)}>${g.label}</button>`)}
        </div>
      </div>
      <${List} title=${`${groups.find(g => g.id === group)?.label || ''} · ${hooks.length} 个类名`}>
        ${hooks.map(h => html`
          <${ListItem} key=${h.hook} title=${`.ph-${h.hook}`} multiline
            subtitle=${`${h.label}${h.note ? '。' + h.note : ''}${h.needs ? `。需要${h.needs}` : ''}`}
            right=${html`<${Icon} name="copy" size=${16}/>`}
            onClick=${() => copy(h.hook)}/>`)}
      <//>
      <${List}>
        <${ListItem} title="写给作者" arrow multiline subtitle="全部类名与变量，以及编写须知"
          left=${html`<${Icon} name="book" size=${18}/>`}
          onClick=${() => nav.push('/contract')}/>
      <//>
    <//>`;
}
