import { html, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, EmptyState, toast, confirm } from '../../../ui/index.js';

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
            <div class="pola-name">${shown}</div>
            ${shown !== char.name ? html`<div class="pola-real">${char.name}</div>` : null}
            ${char.signature ? html`<div class="pola-sign">${char.signature}</div>` : null}
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
        白边上显示名字与签名，签名在编辑资料中填写。
      </div>

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
