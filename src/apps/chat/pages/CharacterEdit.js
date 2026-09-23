import { html, useState, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Field, Input, Textarea, Avatar, List, ListItem,
         Switch, Segmented, Icon, Button, QrLogin, CookiePaste, toast, ZonePicker} from '../../../ui/index.js';
import { AvatarPool } from './AvatarPool.js';

const { db, nav, clock, extras, ai } = phone;

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
  useStore(db.messages.store);
  useStore(db.memories.store);
  const [picking, setPicking] = useState(false);
  const sceneRef = useRef(null);
  const faceRef = useRef(null);
  const char = db.characters.get(id);
  const avatar = useImage(char?.avatar);
  // 原本那张与现在这张。角色在对话里自己换过头像时，两张才不一样
  const faces = phone.avatarLink.facesOf(char);
  const baseFace = useImage(faces.base);
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
          ${faces.changed ? html`
            <div class="face-pair">
              <div class="face-one">
                <${Avatar} src=${baseFace} name=${char.name} size=${64}/>
                <span>原本的</span>
              </div>
              <div class="face-one">
                <${Avatar} src=${avatar} name=${char.name} size=${64}/>
                <span>对话中在用</span>
              </div>
            </div>`
          : html`<${Avatar} src=${avatar} name=${char.name} size=${76}/>`}
          <div class="char-name">${char.name}</div>
        </div>

        ${faces.changed ? html`
          <${List} inset=${false}>
            <${ListItem} title="换回原本的头像" multiline
              subtitle="当前这张是角色在对话中自己换上的。换回之后，原本那张重新成为它的样子。"
              left=${html`<${Icon} name="refresh" size=${18}/>`}
              right=${html`<button class="nav-text press"
                onClick=${() => { phone.avatarLink.restoreFace(id); toast('已换回原本的头像', 'ok'); }}
                >换回</button>`}/>
          <//>` : null}

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

        <${Field} label="语种"
          desc="留空则使用「设置 - 语音」中的全局语种。列表之外的写法可直接填写。">
          <${Input} value=${char.voiceLang || ''} placeholder="留空则跟随全局"
            onInput=${v => patch({ voiceLang: v })}/>
          <div class="chip-row pad-t">
            ${phone.ai.voice.LANGS.filter(l => l.id).map(l => html`
              <button key=${l.id} class=${`chip${char.voiceLang === l.id ? ' is-active' : ''}`}
                onClick=${() => patch({ voiceLang: char.voiceLang === l.id ? '' : l.id })}
                >${l.label}</button>`)}
          </div>
        <//>

        <${Field} label="语音风格"
          desc=${'这个角色说话的语气，随每次合成一并发送。留空则使用「设置 - 语音」中的全局风格。'
            + '各家接口支持的程度不同，具体在那一页中说明。'}>
          <${Input} value=${char.voicePrompt || ''} placeholder="留空则跟随全局"
            onInput=${v => patch({ voicePrompt: v })}/>
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
          subtitle="角色可以接听你的来电，也可以主动打给你。关闭后两者都不再发生"
          right=${html`<${Switch} checked=${char.canCall !== false}
            onChange=${v => patch({ canCall: v })}/>`}/>
        ${char.canCall !== false ? html`
          <div class="pad-x pad-b">
            <${Field} label="接听你的来电"
              desc=${phone.call.answerOf(char) === 'always'
                ? '你打过去，角色总会接听。'
                : `按「主动发起对话」中的免打扰时段（${(() => {
                    const c = ai.proactive.configOf(char);
                    return c.proactiveQuietFrom === c.proactiveQuietTo ? '当前未设置'
                      : `${c.proactiveQuietFrom}:00 到 ${c.proactiveQuietTo}:00`;
                  })()}）：时段内多半不接，其余时间偶尔不接，未接时记一条未接来电。`}>
              <${Segmented} value=${phone.call.answerOf(char)} items=${phone.call.ANSWER}
                onChange=${v => patch({ callAnswer: v })}/>
            <//>
          </div>` : null}
        <${ListItem} title="一起听" multiline
          subtitle="角色可以拉你一起听歌、点歌、建自己的歌单。曲库由你在「一起听」中添加"
          right=${html`<${Switch} checked=${char.canListen !== false}
            onChange=${v => patch({ canListen: v })}/>`}/>
        <${ListItem} title="礼物" multiline
          subtitle="角色可以送礼物给你，也可以拆开或拒收你送的礼物。礼物封面与实际内容可以不一致"
          right=${html`<${Switch} checked=${char.canSendGift !== false}
            onChange=${v => patch({ canSendGift: v })}/>`}/>
        <${ListItem} title="约定" multiline
          subtitle="角色可以提出约定，也可以把做到的约定标记为完成。约定记在情侣空间中"
          right=${html`<${Switch} checked=${char.canPact !== false}
            onChange=${v => patch({ canPact: v })}/>`}/>
        <${ListItem} title="写信" multiline
          subtitle="角色可以写信，信会放进情侣空间的信箱。关闭后角色不再写信，你仍可写给角色"
          right=${html`<${Switch} checked=${char.canWriteLetter !== false}
            onChange=${v => patch({ canWriteLetter: v })}/>`}/>
        <${ListItem} title="当日日程" multiline
          subtitle=${`开启后，每天首次对话前会为这个角色排一次当天的日程，`
            + `并把当前时段的安排带进上下文。每天一次单独的接口调用。`
            + `关闭后角色不再有自己的一天，随机事件与吃饭记录也不再产生`}
          right=${html`<${Switch} checked=${!!char.dayOn}
            onChange=${v => patch({ dayOn: v })}/>`}/>
        <${ListItem} title="点外卖" multiline
          subtitle="角色可以给自己点、请你吃，也可以让你代付。你点给它的那一单，它可以收下或谢绝"
          right=${html`<${Switch} checked=${char.canTakeout !== false}
            onChange=${v => patch({ canTakeout: v })}/>`}/>
        <${ListItem} title="拍一拍" multiline
          subtitle="角色可以主动拍你。你双击角色头像也可以拍它，无论此项开关"
          right=${html`<${Switch} checked=${char.canPat !== false}
            onChange=${v => patch({ canPat: v })}/>`}/>
        <${ListItem} title="骰子" multiline
          subtitle="角色可以掷骰子。点数由本地随机数决定，角色要到下一轮才知道结果"
          right=${html`<${Switch} checked=${char.canDice !== false}
            onChange=${v => patch({ canDice: v })}/>`}/>
        <${ListItem} title="随机事件" multiline
          subtitle=${`角色的每一天可能撞上一件事，从「日常」的事件库中由本地随机数抽取，`
            + `不消耗接口调用。关闭后这个角色不再遇到随机事件`}
          right=${html`<${Switch} checked=${char.eventsOn !== false}
            onChange=${v => patch({ eventsOn: v })}/>`}/>
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

      <${List} title="MCP 工具">
        ${phone.ai.services.mcpServers().length ? phone.ai.services.mcpServers().map(sv => {
          const on = (char.mcpServers || []).includes(sv.id);
          const n = (sv.tools || []).length - (sv.toolsOff || []).length;
          return html`
            <${ListItem} key=${sv.id} title=${sv.name || '未命名'} multiline
              subtitle=${sv.error ? `连接失败：${sv.error}` : sv.checkedAt ? `${n} 个工具` : '尚未连接，请先在「MCP」中连接'}
              right=${html`<${Switch} checked=${on} onChange=${v => patch({
                mcpServers: v ? [...new Set([...(char.mcpServers || []), sv.id])]
                  : (char.mcpServers || []).filter(x => x !== sv.id),
              })}/>`}/>`;
        }) : html`
          <${ListItem} title="尚未添加 MCP 服务器" arrow multiline
            subtitle="在「MCP」中添加服务器后，可在此选择该角色能够调用哪几台"
            onClick=${() => phone.intent.open('mcp', { route: '/', back: true })}/>`}
      <//>
      ${(char.mcpServers || []).length ? html`
        <div class="settings-foot">
          开启的服务器上的工具连同参数说明会随每一轮请求发送给模型。
          角色调用工具时是否需要你确认，在各服务器的设置中选择。
        </div>` : null}

      ${phone.ai.services.neteaseReady() && char.canListen !== false ? html`
        <${List} title="角色的网易云账号">
          ${char.neteaseCookie ? html`
            <${ListItem} title=${char.neteaseNick || '已登录'} multiline
              subtitle=${`UID ${char.neteaseUid}。一起听时这个账号也会记录听歌。`}
              right=${html`<button class="nav-text press"
                onClick=${() => phone.netease.logout(id)}>退出</button>`}/>`
          : html`<${ListItem} title="尚未登录" multiline
              subtitle="登录另一个网易云账号作为这个角色的账号。一起听时两个账号都会记录这次听歌。"/>`}
        <//>
        ${char.neteaseCookie ? null : html`
          <div class="pad">
            <${QrLogin} service=${phone.netease} owner=${id}
              hint="请使用网易云音乐扫描二维码，登录要给这个角色用的那个账号"/>
            <${CookiePaste} service=${phone.netease} owner=${id}
              hint=${`在浏览器中登录要给这个角色用的那个网易云账号，`
                + `从开发者工具的存储中复制 MUSIC_U 的值。`
                + `扫码被网易云拦下时（code -462）可用这种方式。`}/>
          </div>`}` : null}

      ${clock.enabled() ? html`
        <${List} title="角色所在时区">
          <${ListItem} title="所在时区" arrow multiline
            subtitle=${char.timezone
              ? `${clock.zoneLabel(char.timezone)} · 当前 ${clock.clockOnly(clock.now(), char.timezone)}`
              : `尚未设置，暂时跟随你所在的时区 · 当前 ${clock.clockOnly(clock.now(), clock.userZone())}`}
            left=${html`<${Icon} name="map" size=${18}/>`}
            onClick=${() => setPicking(true)}/>
        <//>
        <div class="settings-foot">
          设为其他国家后，角色将按该地的作息与时间作出反应。
          未设置时，角色使用你所在时区的时间，且 prompt 中不会写出它身处何地。
          角色设定在其他国家时请在此设置，否则它报出的时间是你这边的时间。
          本人所在时区在「上下文与记忆 - 时间感知」中设置。
        </div>` : null}

      <${Field} label="所在地区"
        desc="决定这个角色吃到的是哪一批食物。与「日常 - 吃什么」里的地区名写成一样，两边才对得上。留空则只吃不分地区的那一批。">
        <${Input} value=${char.region || ''} placeholder="例如：成都"
          onInput=${v => patch({ region: v })}/>
      <//>

      <${List} title="关系">
        <${ListItem} title="特别关心" multiline
          subtitle="该角色的消息、来电与动态在通知中加上「特别关心」前缀，动态另行提醒"
          right=${html`<${Switch} checked=${!!char.star}
            onChange=${v => extras.setStar(char.id, v)}/>`}/>
      <//>

      <${Field} label="别人拍这个角色时显示的后缀"
        desc=${`双击角色头像即可拍一拍。后缀由被拍的一方设定，所以这一项是你拍它时显示的。`
          + `留空则使用「${extras.DEFAULT_PAT}」。你自己的那一项在会话菜单的「互动」里。`}>
        <${Input} value=${char.patSuffix || ''} placeholder=${extras.DEFAULT_PAT}
          onInput=${v => extras.setCharPat(char.id, v)}/>
      <//>

      <${AvatarPool} char=${char}/>

      <${List} title="一起看">
        <${ListItem} title="这部片它看过" multiline
          subtitle="开启后，角色在一起看时知道后续情节，但仍不会说破。关闭则只知道已经播放过的部分"
          right=${html`<${Switch} checked=${!!char.watchedBefore}
            onChange=${v => patch({ watchedBefore: v })}/>`}/>
      <//>

      <${List} title="她的书架">
        <${ListItem} title="个人书架" arrow multiline
          subtitle=${(() => {
            const n = (char.shelf || []).length;
            return n ? `${n} 本。导入同名的书之后可以一起读` : '还没有。放上几本这个角色读过的书';
          })()}
          left=${html`<${Icon} name="book" size=${18}/>`}
          onClick=${() => phone.intent.open('theater', { route: `/shelf/${id}` })}/>
      <//>

      <${List} title="关联世界书">
        ${db.lorebooks.all().map(b => html`
          <${ListItem} key=${b.id} title=${b.name}
            subtitle=${(b.global ? '全局生效，无需关联' : `${(b.entries || []).length} 个条目`)
              + ({ image: ' · 只用于生图', voice: ' · 只用于语音' }[ai.lore.purposeOf(b)] || '')}
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
