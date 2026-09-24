import { html, useRef, useState, useEffect } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, EmptyState, Sheet, toast, confirm, prompt } from '../../../ui/index.js';

const { db, nav } = phone;

// 角色卡的展示页：一张拍立得。
//
// 相纸上是这个角色「长什么样」的形象照，下面白边写名字和签名。和聊天头像、
// 锁脸照片是三样东西，各存各的（见 system/avatar.js 的 setPortrait）。
//
// **人设一个字都不露**（CLAUDE.md 第 6 条）。这一页是给人看这个角色的，
// 要改设定点「编辑资料」进编辑页。
export function CharCard({ charId }) {
  useStore(db.characters.store);
  const char = db.characters.get(charId);
  const photo = useImage(char?.portrait || null);
  const fileRef = useRef(null);
  const [picking, setPicking] = useState(false);
  useStore(db.settings.store);
  if (!char) {
    return html`<${Page} title="角色卡" onBack=${nav.pop}><${EmptyState} title="该角色已不存在"/><//>`;
  }

  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { await phone.avatarLink.setPortrait(charId, file); toast('已更换形象照', 'ok'); }
    catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };
  const drop = async () => {
    if (!await confirm({ title: '移除形象照', okText: '移除', danger: true,
      message: '只移除展示页上的这一张，聊天头像与锁脸照片不受影响。' })) return;
    phone.avatarLink.clearPortrait(charId);
  };
  const shown = phone.remark.nameOf(char);

  return html`
    <${Page} title="角色卡" onBack=${nav.pop}>
      <div class="pola-stage">
        <button class="pola press" onClick=${() => fileRef.current?.click()}
          aria-label=${char.portrait ? '更换形象照' : '上传形象照'}>
          <div class=${`pola-photo${photo ? '' : ' is-empty'}`} style=${photo ? `--pola:url(${photo})` : ''}>
            ${photo ? null : html`
              <span class="pola-hint"><${Icon} name="image" size=${26}/><span>上传形象照</span></span>`}
          </div>
          <div class="pola-foot">
            <div class="pola-sign">${char.signature || shown}</div>
            ${char.signature ? html`<div class="pola-at">@${shown}</div>` : null}
          </div>
        </button>
      </div>
      <input type="file" accept="image/*" ref=${fileRef} onChange=${pick} style="display:none"/>

      <div class="pad btn-row">
        <${Button} variant="ghost" icon="upload" onClick=${() => fileRef.current?.click()}>
          ${char.portrait ? '更换形象照' : '上传形象照'}<//>
        ${char.portrait ? html`<${Button} variant="ghost" icon="trash" onClick=${drop}>移除<//>` : null}
      </div>
      <div class="settings-foot">
        形象照展示这个角色的样子，与聊天头像、锁脸照片分开保存，不发送给模型。
        白边上以手写体显示个性签名，签名在编辑资料中填写。
      </div>

      <${List}>
        <${ListItem} title="签名字体" arrow multiline
          subtitle="所有角色卡共用一种。可从字体库选择，或按网址、按文件添加"
          right=${phone.fonts.get(db.settings.get().fontHand)?.name || '默认手写体'}
          left=${html`<${Icon} name="edit" size=${18}/>`}
          onClick=${() => setPicking(true)}/>
      <//>
      ${picking ? html`<${HandFont} sample=${char.signature || shown} onClose=${() => setPicking(false)}/>` : null}

      <${List}>
        <${ListItem} title="编辑资料" arrow subtitle="人设、当日日程与各项能力的开关" multiline
          left=${html`<${Icon} name="edit" size=${18}/>`}
          onClick=${() => nav.push(`/edit/${charId}`)}/>
        <${ListItem} title="角色主页" arrow
          left=${html`<${Icon} name="camera" size=${18}/>`}
          onClick=${() => nav.push(`/profile/${charId}`)}/>
      <//>
    <//>`;
}

// 签名用哪种手写体。字体库是全应用共用的一份（设置 - 主题 - 字体），这里只选「手写」那一槽。
// 预设的几款是 Google Fonts 的中文手写体，点一下按网址加进字体库；需要联网才显示。
function HandFont({ sample, onClose }) {
  const s = useStore(db.settings.store);
  const fileRef = useRef(null);
  const list = phone.fonts.list();
  const cur = s.fontHand || '';
  // 在线字体要先挂上样式表，预览那一行才看得出长什么样
  useEffect(() => { list.forEach(f => phone.fonts.ensureLoaded(f.id).catch(() => {})); }, [list.length]);

  const choose = id => { db.settings.set({ fontHand: id }); };
  const run = async job => {
    try { const rec = await job(); await phone.fonts.ensureLoaded(rec.id).catch(() => {}); choose(rec.id); toast(`已添加 ${rec.name}`, 'ok'); }
    catch (err) { toast(String(err.message || err), 'error', 6000); }
  };
  const byUrl = async () => {
    const url = await prompt({ title: '按网址添加字体', okText: '添加',
      message: '字体文件的网址（.woff2 .ttf 等）会下载保存到本机；样式表网址（如 Google Fonts）会保留为在线字体，需要联网才显示。',
      placeholder: 'https://' });
    if (url) run(() => phone.fonts.addUrl(url));
  };
  const byFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) run(() => phone.fonts.add(file));
  };
  const have = new Set(list.map(f => f.css).filter(Boolean));
  const presets = phone.fonts.HAND_PRESETS.filter(p => !have.has(p.url));
  const line = (key, title, fam, on, onTap) => html`
    <${ListItem} key=${key} title=${title} multiline onClick=${onTap}
      subtitle=${html`<span class="hand-sample" style=${`--hand:${fam}`}>${sample}</span>`}
      right=${on ? html`<${Icon} name="check" size=${17}/>` : null}/>`;

  return html`
    <${Sheet} open=${true} onClose=${onClose} title="签名字体" height="72%">
      <${List} inset=${false}>
        ${line('', '默认手写体', 'var(--font-hand-base)', !cur, () => choose(''))}
        ${list.map(f => line(f.id, f.name, `"${phone.fonts.familyOf(f.id)}"`, cur === f.id, () => choose(f.id)))}
      <//>
      ${presets.length ? html`
        <div class="list-title">常用手写体 · 需要联网</div>
        <${List} inset=${false}>
          ${presets.map(p => html`
            <${ListItem} key=${p.url} title=${p.name} subtitle="添加到字体库并使用" arrow
              onClick=${() => run(() => phone.fonts.addUrl(p.url, p.name))}/>`)}
        <//>` : null}
      <div class="pad btn-row">
        <${Button} variant="ghost" icon="plus" onClick=${byUrl}>按网址添加<//>
        <${Button} variant="ghost" icon="upload" onClick=${() => fileRef.current?.click()}>按文件添加<//>
      </div>
      <input type="file" accept=${phone.fonts.ACCEPT} ref=${fileRef} onChange=${byFile} style="display:none"/>
      <div class="settings-foot">
        默认手写体使用系统自带的楷体或行楷，设备上没有时显示为普通字体。
        添加的字体进入全应用共用的字体库，可在「设置 - 主题 - 字体」中改名或删除。
      </div>
    <//>`;
}
