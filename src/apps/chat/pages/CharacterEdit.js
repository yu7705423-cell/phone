import { html, useState, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Field, Input, Textarea, Avatar, List, ListItem,
         Switch, Segmented, Icon, Button, toast } from '../../../ui/index.js';
import { ZonePicker } from './ZonePicker.js';

const { db, nav, clock } = phone;

const FACE_MODES = [
  { value: 'off', label: '关闭' },
  { value: 'self', label: '涉及本人时' },
  { value: 'always', label: '始终' },
];

export function CharacterEdit({ id }) {
  useStore(db.characters.store);
  useStore(db.lorebooks.store);
  useStore(db.settings.store);
  useStore(db.stickers.store);
  const [picking, setPicking] = useState(false);
  const sceneRef = useRef(null);
  const faceRef = useRef(null);
  const char = db.characters.get(id);
  const avatar = useImage(char?.avatar);
  const scene = useImage(char?.callImage);
  const face = useImage(char?.faceImage);
  const stickerCount = db.stickers.count();

  if (!char) return html`<${Page} title="编辑" onBack=${nav.pop}/>`;
  const patch = p => db.characters.update(id, p);

  // 换了脸图，之前读出来那段外貌描述就作废了，不然新脸配旧描述
  const pickFace = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const imgId = await db.images.put(file);
      if (char.faceImage) db.images.remove(char.faceImage);
      patch({ faceImage: imgId, faceDesc: '' });
    } catch (err) { toast('图片处理失败：' + (err.message || err), 'error'); }
  };

  const pickScene = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const imgId = await db.images.put(file);
      if (char.callImage) db.images.remove(char.callImage);
      patch({ callImage: imgId });
    } catch (err) { toast('图片处理失败：' + (err.message || err), 'error'); }
  };

  const toggleBook = bid => {
    const cur = char.lorebookIds || [];
    patch({ lorebookIds: cur.includes(bid) ? cur.filter(x => x !== bid) : [...cur, bid] });
  };

  return html`
    <${Page} title="角色卡" onBack=${nav.pop}>
      <div class="pad">
        <div class="avatar-picker">
          <${Avatar} src=${avatar} name=${char.name} size=${76}/>
          <div class="char-name">${char.name}</div>
        </div>

        <${List} inset=${false}>
          <${ListItem} title="人设、情境、开场白、对话示例" arrow multiline
            subtitle=${char.persona ? '在「联系」中编辑' : '尚未填写。这些内容决定角色是谁，请在「联系」中填写'}
            left=${html`<${Icon} name="user" size=${18}/>`}
            onClick=${() => phone.intent.open('contact', { route: `/char/${id}` })}/>
        <//>

        <${Field} label="音色 ID"
          desc="语音合成使用的音色。接口与模型在「设置 - 语音」中配置，此处仅指定该角色使用的音色。">
          <${Input} value=${char.voiceId || ''} placeholder="例如 male-qn-qingse"
            onInput=${v => patch({ voiceId: v })}/>
        <//>

        <${Field} label=${`语速　${(char.voiceSpeed ?? 1).toFixed(2)}`} desc="1 为正常语速">
          <input type="range" min="0.5" max="2" step="0.05" value=${char.voiceSpeed ?? 1}
            onInput=${e => patch({ voiceSpeed: parseFloat(e.target.value) })}/>
        <//>
      </div>

      <${List} title="角色可主动发送的内容">
        <${ListItem} title="语音" multiline
          subtitle=${char.voiceId ? '角色会在合适时以语音代替文字' : '尚未填写音色 ID，填写后生效'}
          right=${html`<${Switch} checked=${char.canSendVoice !== false}
            onChange=${v => patch({ canSendVoice: v })}/>`}/>
        <${ListItem} title="图片" subtitle="角色会在合适时描述画面，交由生图接口生成"
          multiline
          right=${html`<${Switch} checked=${char.canSendImage !== false}
            onChange=${v => patch({ canSendImage: v })}/>`}/>
        <${ListItem} title="表情" multiline
          subtitle=${stickerCount
            ? `可用表情 ${stickerCount} 个。名称会随对话一并提供给角色，由角色自行选用`
            : '尚无表情包。在会话菜单的「表情包」中导入后生效'}
          right=${html`<${Switch} checked=${char.canSendSticker !== false}
            onChange=${v => patch({ canSendSticker: v })}/>`}/>
        <${ListItem} title="转账" multiline
          subtitle="角色可以转账给你，也可以收下或退回你转过去的款项。关闭后角色不再转账，你转过去的款项也将无人处理"
          right=${html`<${Switch} checked=${char.canTransfer !== false}
            onChange=${v => patch({ canTransfer: v })}/>`}/>
        <${ListItem} title="通话" multiline
          subtitle="角色可以接听你的来电，也可以主动打给你。是否接听取决于「主动发起对话」中设置的免打扰时段"
          right=${html`<${Switch} checked=${char.canCall !== false}
            onChange=${v => patch({ canCall: v })}/>`}/>
        <${ListItem} title="一起听" multiline
          subtitle="角色可以拉你一起听歌、点歌、建自己的歌单。曲库由你在「一起听」中添加"
          right=${html`<${Switch} checked=${char.canListen !== false}
            onChange=${v => patch({ canListen: v })}/>`}/>
        <${ListItem} title="礼物" multiline
          subtitle="角色可以送礼物给你，也可以拆开或拒收你送的礼物。礼物封面与实际内容可以不一致"
          right=${html`<${Switch} checked=${char.canSendGift !== false}
            onChange=${v => patch({ canSendGift: v })}/>`}/>
        <${ListItem} title="位置" multiline
          subtitle=${char.timezone
            ? `角色会发送所在地的地点。地点以所在时区「${clock.zoneLabel(char.timezone)}」为准`
            : '角色会发送所在地的地点。未设置所在时区时，地点依据人设判断'}
          right=${html`<${Switch} checked=${char.canSendLocation !== false}
            onChange=${v => patch({ canSendLocation: v })}/>`}/>
      <//>

      <${Field} label="这个角色的生图提示词"
        desc="生成这个角色相关的图片时拼在画面描述后面。全局提示词在「设置 - 生图」中设置，两者都会生效。">
        <${Textarea} rows=${3} value=${char.imagePrompt || ''}
          placeholder="例如：黑色长发，穿深色衬衫"
          onInput=${v => patch({ imagePrompt: v })}/>
      <//>

      <${Field} label="锁脸"
        desc=${char.faceImage
          ? (char.faceDesc
            ? `已读取外貌描述：${char.faceDesc.slice(0, 30)}…`
            : '尚未读取外貌描述，首次生成相关图片时自动读取一次并保存')
          : '上传一张脸部照片后生效。用于让这个角色每次生成的长相保持一致。'}>
        <${Segmented} value=${char.faceLock || 'self'} items=${FACE_MODES}
          onChange=${v => patch({ faceLock: v })}/>
        <div class="wg-edit-cover pad-t">
          <${Button} size="sm" variant="ghost" icon="upload"
            onClick=${() => faceRef.current?.click()}>${char.faceImage ? '更换照片' : '选择照片'}<//>
          ${char.faceImage ? html`
            <${Button} size="sm" variant="ghost" icon="refresh"
              onClick=${() => { patch({ faceDesc: '' }); toast('已清除，下次生成时重新读取'); }}>重新读取<//>
            <${Button} size="sm" variant="ghost" icon="trash"
              onClick=${() => { db.images.remove(char.faceImage); patch({ faceImage: null, faceDesc: '' }); }}>移除<//>` : null}
        </div>
        <input type="file" accept="image/*" ref=${faceRef} onChange=${pickFace} style="display:none"/>
        ${face ? html`<div class="face-preview" style=${`background-image:url(${face})`}></div>` : null}
      <//>

      <${Field} label="视频通话画面"
        desc="视频通话时铺满屏幕的画面。未上传时使用头像。图片保存在本设备。">
        <div class="wg-edit-cover">
          <${Button} size="sm" variant="ghost" icon="upload"
            onClick=${() => sceneRef.current?.click()}>${char.callImage ? '更换' : '选择图片'}<//>
          ${char.callImage ? html`
            <${Button} size="sm" variant="ghost" icon="trash"
              onClick=${() => { db.images.remove(char.callImage); patch({ callImage: null }); }}>移除<//>` : null}
        </div>
        <input type="file" accept="image/*" ref=${sceneRef} onChange=${pickScene} style="display:none"/>
        ${scene ? html`<div class="call-scene-preview" style=${`background-image:url(${scene})`}></div>` : null}
      <//>

      ${clock.enabled() ? html`
        <${List} title="角色所在时区">
          <${ListItem} title="所在时区" arrow multiline
            subtitle=${char.timezone
              ? `${clock.zoneLabel(char.timezone)} · 当前 ${clock.clockOnly(clock.now(), char.timezone)}`
              : `与本人相同 · 当前 ${clock.clockOnly(clock.now(), clock.userZone())}`}
            left=${html`<${Icon} name="map" size=${18}/>`}
            onClick=${() => setPicking(true)}/>
        <//>
        <div class="settings-foot">
          设为其他国家后，角色将按该地的作息与时间作出反应。
          本人所在时区在「上下文与记忆 - 时间感知」中设置。
        </div>` : null}

      <${List} title="关联世界书">
        ${db.lorebooks.all().map(b => html`
          <${ListItem} key=${b.id} title=${b.name}
            subtitle=${b.global ? '全局生效，无需关联' : `${(b.entries || []).length} 个条目`}
            right=${html`<${Switch} checked=${b.global || (char.lorebookIds || []).includes(b.id)}
              onChange=${() => !b.global && toggleBook(b.id)}/>`}/>`)}
        ${!db.lorebooks.count() ? html`<${ListItem} title="暂无世界书"/>` : null}
      <//>
      <div class="pad-b"></div>

      <${ZonePicker} open=${picking} value=${char.timezone || ''} allowSame
        title=${`${char.name} 所在时区`}
        onPick=${z => patch({ timezone: z })}
        onClose=${() => setPicking(false)}/>
    <//>`;
}
