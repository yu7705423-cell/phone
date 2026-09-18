import { html, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { List, ListItem, Icon, IconButton, toast, confirm, prompt } from '../../../ui/index.js';

const { db, images, avatarLink } = phone;

function PoolItem({ char, item }) {
  const url = useImage(item.imageId);
  const wearing = char.avatar === item.imageId;
  const del = async () => {
    if (!await confirm({ title: '移出头像库', message: `将移出「${item.name}」。`, danger: true })) return;
    avatarLink.removeFromPool(char.id, item.imageId);
  };
  return html`
    <${ListItem} title=${item.name} subtitle=${wearing ? '正在用这一张' : ''}
      left=${url
        ? html`<img class="pool-thumb" src=${url} alt=""/>`
        : html`<${Icon} name="user" size=${18}/>`}
      right=${html`<${IconButton} name="trash" size=${17} label="移出" onClick=${del}/>`}/>`;
}

// 角色的头像库。用户先传几张进去，角色自己挑一张换上。
// 不给它上网找 —— 纯浏览器里没有那个能力，见 ARCHITECTURE 4.84。
export function AvatarPool({ char }) {
  useStore(db.characters.store);
  const fileRef = useRef(null);
  const pool = avatarLink.poolOf(char);

  const add = async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const file of files) {
      const name = await prompt({
        title: '给这一张起个名字',
        message: '角色按名字挑头像，所以名字要能分得开，例如「白猫」「黑底」。',
        value: file.name.replace(/\.[^.]+$/, '').slice(0, 20),
      });
      if (name === null) continue;
      try {
        const id = await images.putIcon(file);
        avatarLink.addToPool(char.id, { imageId: id, name });
      } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
    }
  };

  return html`
    <${List} title="头像库">
      ${pool.length
        ? pool.map(it => html`<${PoolItem} key=${it.imageId} char=${char} item=${it}/>`)
        : html`<${ListItem} title="还没有可换的头像" multiline
            subtitle="传几张进去，角色就可以自己挑一张换上。库为空时，角色不知道有这回事"/>`}
      <${ListItem} title="添加" arrow
        left=${html`<${Icon} name="upload" size=${18}/>`}
        onClick=${() => fileRef.current?.click()}/>
      <input type="file" accept="image/*" multiple ref=${fileRef} onChange=${add} style="display:none"/>
    <//>`;
}
