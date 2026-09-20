import { html, useState } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Icon, Switch, EmptyState, Sheet,
         confirm, toast } from '../../../ui/index.js';

const { db, nav, theirs } = phone;

// 这台手机上的相册。**角色手机唯一自己拥有的东西。**
//
// 一张「照片」记的是一句描述，图片可有可无 —— 模型手里没有照片，
// 让它写一句「拍到了什么」是它做得到的事。真图事后自己挂上去。
//
// 本子可以设密码。**那不是加密**，库里就是明文，界面上也这么写：
// 它挡的是顺手翻到，不是挡人来查。开过之后只在这次打开期间有效，和锁屏一样。

const UNFILED = '';

function Shot({ photo, onOpen }) {
  const url = useImage(photo.imageId);
  return html`
    <button class="tp-shot press" onClick=${onOpen}>
      ${url ? html`<span class="tp-shot-img" style=${`background-image:url(${url})`}></span>`
        : html`<span class="tp-shot-none"><${Icon} name="image" size=${18}/></span>`}
      <span class="tp-shot-note ellipsis">${photo.note || '没有描述'}</span>
      ${photo.from === 'you'
        ? html`<span class="tp-shot-from">${photo.cropped ? '你发的 · 已裁' : '你发的'}</span>`
        : null}
    </button>`;
}

export function AlbumPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.phones.store);
  const char = db.characters.get(charId);
  const [at, setAt] = useState(UNFILED);      // 正在看哪一本
  const [code, setCode] = useState('');
  const [making, setMaking] = useState(null); // 正在新建/改的那一本
  const [editing, setEditing] = useState(null); // 正在改的那一张

  if (!char) {
    return html`<${Page} title="相册" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const albums = theirs.albumsOf(charId);
  const photos = theirs.inAlbum(charId, at);
  const book = at ? theirs.albumOf(charId, at) : null;
  const locked = at && !theirs.albumOpen(charId, at);

  const saveAlbum = () => {
    const name = String(making.name || '').trim();
    if (!name) { toast('请填写名称'); return; }
    if (making.id) theirs.updateAlbum(charId, making.id, { name, code: making.code });
    else theirs.addAlbum(charId, making);
    setMaking(null);
    toast('已保存', 'ok');
  };

  const dropAlbum = async a => {
    if (!await confirm({ title: `删除「${a.name}」`, danger: true, okText: '删除',
      message: '里面的照片不会删除，会退回未归类。' })) return;
    theirs.removeAlbum(charId, a.id);
    if (at === a.id) setAt(UNFILED);
    toast('已删除');
  };

  const dropPhoto = async p => {
    if (!await confirm({ title: '删除这一张', danger: true, okText: '删除',
      message: '删除后无法恢复，可以重新生成。' })) return;
    theirs.removePhoto(charId, p.id);
    setEditing(null);
    toast('已删除');
  };

  const tryOpen = () => {
    if (theirs.openAlbum(charId, at, code)) { setCode(''); return; }
    toast('密码不对', 'error');
    setCode('');
  };

  return html`
    <${Page} title="相册" onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => nav.push(`/make/${charId}`)}>生成</button>`}>

      <div class="chip-row pad-x pad-t">
        <button class=${`chip${at === UNFILED ? ' is-active' : ''}`}
          onClick=${() => setAt(UNFILED)}>
          未归类 ${theirs.inAlbum(charId, UNFILED).length}
        </button>
        ${albums.map(a => html`
          <button key=${a.id} class=${`chip${at === a.id ? ' is-active' : ''}`}
            onClick=${() => setAt(a.id)}>
            ${a.code ? '· ' : ''}${a.name} ${theirs.inAlbum(charId, a.id).length}
          </button>`)}
        <button class="chip" onClick=${() => setMaking({ name: '', code: '' })}>新建</button>
      </div>

      ${book ? html`
        <${List}>
          <${ListItem} title=${book.name} multiline
            subtitle=${book.code ? '已设密码。密码以明文保存，只用于不直接显示，不是加密' : '没有设密码'}
            left=${html`<${Icon} name=${book.code ? 'lock' : 'folder'} size=${18}/>`}
            right=${html`
              <span class="row-acts">
                <button class="press" aria-label="设置这一本"
                  onClick=${() => setMaking({ ...book })}><${Icon} name="edit" size=${16}/></button>
                <button class="press" aria-label=${`删除 ${book.name}`}
                  onClick=${() => dropAlbum(book)}><${Icon} name="trash" size=${16}/></button>
              </span>`}/>
        <//>` : null}

      ${locked ? html`
        <div class="pad-x pad-t">
          <div class="hint-box">这一本设了密码。输入密码后可以查看。</div>
          <${Field} label="密码">
            <${Input} type="password" value=${code} onInput=${setCode}
              placeholder="输入这一本的密码"/>
          <//>
          <${Button} full onClick=${tryOpen}>打开<//>
        </div>`
      : photos.length ? html`
        <div class="tp-shots">
          ${photos.map(p => html`
            <${Shot} key=${p.id} photo=${p} onOpen=${() => setEditing(p)}/>`)}
        </div>`
      : html`
        <${EmptyState} icon="camera" title=${at ? '这一本还是空的' : '还没有照片'}
          desc=${at ? '把未归类里的照片移进来，或者重新生成。'
            : '依据该角色的设定生成这台手机里的照片。'}
          action=${at ? null : html`<${Button} size="sm" icon="plus"
            onClick=${() => nav.push(`/make/${charId}`)}>去生成<//>`}/>`}

      <${List} title="角色自己存">
        <${ListItem} title="允许该角色在对话中存照片" multiline
          subtitle=${'开启后，该角色可以在回复中写一行标记，把一张照片存进这里。'
            + '该标记不会作为消息发出，对话中只留下一行提示。'
            + '开启会在每轮提示词中增加一条说明，因此默认关闭。'}
          right=${html`<${Switch} checked=${theirs.keepOn(charId)}
            onChange=${v => theirs.setKeepOn(charId, v)}/>`}/>
      <//>

      <div class="settings-foot">
        生成的照片只有一句描述，可以为某一张挂上真实图片。
        标有「你发的」的是该角色从对话中存下的照片，描述是该角色自己写的。
        标有「已裁」的，图片是按那句描述裁过的，与你发送的原图不同；
        没有这个标记的就是原图。裁切需要识图接口，开关在「设置 - 用量与上限」，
        默认关闭。
      </div>

      <${Sheet} open=${!!making} onClose=${() => setMaking(null)}
        title=${making?.id ? '相册设置' : '新建相册'}>
        <div class="pad-x">
          <${Field} label="名称">
            <${Input} value=${making?.name || ''}
              onInput=${v => setMaking({ ...making, name: v })} placeholder="例如 去年夏天"/>
          <//>
          <${Field} label="密码"
            desc="留空表示不设密码。密码以明文保存在本机，只用于不直接显示内容，不是加密。">
            <${Input} value=${making?.code || ''}
              onInput=${v => setMaking({ ...making, code: v })} placeholder="可留空"/>
          <//>
        </div>
        <div class="pad batch-acts">
          <${Button} onClick=${saveAlbum}>保存<//>
          <${Button} variant="ghost" onClick=${() => setMaking(null)}>取消<//>
        </div>
      <//>

      <${Sheet} open=${!!editing} onClose=${() => setEditing(null)} title="这一张">
        <div class="pad-x">
          <${Field} label="描述">
            <${Input} value=${editing?.note || ''}
              onInput=${v => { theirs.updatePhoto(charId, editing.id, { note: v });
                setEditing({ ...editing, note: v }); }}/>
          <//>
          <${Field} label="放进哪一本">
            <div class="chip-row">
              <button class=${`chip${!editing?.albumId ? ' is-active' : ''}`}
                onClick=${() => { theirs.updatePhoto(charId, editing.id, { albumId: '' });
                  setEditing({ ...editing, albumId: '' }); }}>未归类</button>
              ${albums.map(a => html`
                <button key=${a.id} class=${`chip${editing?.albumId === a.id ? ' is-active' : ''}`}
                  onClick=${() => { theirs.updatePhoto(charId, editing.id, { albumId: a.id });
                    setEditing({ ...editing, albumId: a.id }); }}>${a.name}</button>`)}
            </div>
          <//>
        </div>
        <div class="pad batch-acts">
          <${Button} variant="danger" onClick=${() => dropPhoto(editing)}>删除<//>
          <${Button} variant="ghost" onClick=${() => setEditing(null)}>好了<//>
        </div>
      <//>
    <//>`;
}
