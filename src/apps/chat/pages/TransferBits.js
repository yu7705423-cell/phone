import { html, useState, useRef, useEffect } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { SongCard } from './SongCard.js';
import { Sheet, Field, Input, Button, Icon, List, ListItem, Switch, Segmented, toast } from '../../../ui/index.js';

const { db, transfer, currency, place, call, gift, listen, music, watch, subtitle,
  request, ledger, intent } = phone;

// 转账气泡。发出去的那一张不能自己点 —— 收不收是对方的事。
export function TransferBubble({ msg, onSettle }) {
  const mine = msg.role === 'user';
  const pending = msg.transfer === transfer.PENDING;
  const actionable = pending && !mine && onSettle;
  return html`
    <div class=${`bubble bubble-transfer ph-transfer${pending ? '' : ' is-done'}`}
      onClick=${actionable ? () => onSettle(msg) : null}>
      <div class="tr-top">
        <${Icon} name="wallet" size=${20}/>
        <div class="tr-body">
          <div class="tr-amount">${transfer.display(msg.amount, msg.currency)}</div>
          ${msg.note ? html`<div class="tr-note ellipsis">${msg.note}</div>` : null}
        </div>
      </div>
      <div class="tr-foot">
        ${transfer.stateLabel(msg.transfer)}${actionable ? ' · 点击处理' : ''}
      </div>
    </div>`;
}

// 提示行。不占气泡，居中一行灰字，两边都看得见刚才发生了什么。
export function NoticeLine({ msg }) {
  const text = String(msg.content || '').replace(/^\[|\]$/g, '');
  // 角色往歌单里放了歌：点这一行直接打开那个歌单，看里面有什么、从那儿一起听
  if (msg.playlistId) {
    return html`<button class="conv-notice press"
      onClick=${() => phone.intent.open('music', { route: `/local/${msg.playlistId}/${msg.chatId}`, back: true })}>${text}</button>`;
  }
  return html`<div class="conv-notice">${text}</div>`;
}

// 发起转账
export function TransferSheet({ open, chatId, onClose }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  const [conv, setConv] = useState(false);
  const [from, setFrom] = useState('CNY');
  const [src, setSrc] = useState('');
  const [rateText, setRateText] = useState('');
  const cur = currency.current();

  // 换算只发生在输入这一步：填你习惯的那种钱，按汇率折成这段对话的币种。
  // 落库的一律是折算之后的数 —— 一段对话里两个人用的是同一种钱。
  const saved = currency.rateOf(from, cur.code);
  const rate = rateText !== '' ? Number(rateText) : saved;
  const out = rate > 0 && Number(src) > 0
    ? currency.round(Number(src) * rate, cur.code) : null;

  const useIt = () => {
    if (out === null) return;
    if (rateText !== '' && Number(rateText) > 0) currency.setRate(from, cur.code, rateText);
    setAmount(String(out));
    setConv(false); setSrc(''); setRateText('');
  };

  const close = () => {
    setAmount(''); setNote(''); setPicking(false);
    setConv(false); setSrc(''); setRateText('');
    onClose();
  };
  const submit = () => {
    try {
      transfer.send({ chatId, role: 'user', authorId: 'me', amount, note });
      close();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const ok = transfer.money(amount) > 0;
  return html`
    <${Sheet} open=${open} onClose=${close} title="转账">
      <${Field} label="金额"
        desc=${cur.digits ? `最多 ${cur.digits} 位小数。` : `${cur.name}不使用小数。`}>
        <${Input} value=${amount} type="number" inputmode="decimal"
          placeholder=${(0).toFixed(cur.digits)} onInput=${setAmount}/>
      <//>

      <${List} inset=${false}>
        <${ListItem} title="币种" subtitle=${`${cur.name}${cur.symbol ? ` · ${cur.symbol}` : ''}`}
          arrow onClick=${() => setPicking(true)}/>
        <${ListItem} title="按汇率换算" multiline
          subtitle=${`填另一种货币的金额，折成${cur.name}填进上面的金额栏`}
          right=${html`<${Switch} checked=${conv} onChange=${setConv}/>`}/>
      <//>

      ${conv ? html`
        <div class="pad-x">
          <${Field} label="原币种">
            <div class="chip-row">
              ${currency.LIST.filter(c => c.code !== 'none' && c.code !== cur.code).map(c => html`
                <button key=${c.code} class=${`chip${from === c.code ? ' is-active' : ''}`}
                  onClick=${() => { setFrom(c.code); setRateText(''); }}>${c.name}</button>`)}
            </div>
          <//>
          <${Field} label=${`${currency.get(from).name}金额`}>
            <${Input} value=${src} type="number" inputmode="decimal"
              placeholder="0" onInput=${setSrc}/>
          <//>
          <${Field} label="汇率"
            desc=${`1 ${currency.get(from).name}折合多少${cur.name}。`
              + (saved ? '这一对已经填过，可以直接改。' : '自行填写，不联网获取。')}>
            <${Input} value=${rateText !== '' ? rateText : (saved ?? '')} type="number"
              inputmode="decimal" placeholder="例如 20.5"
              onInput=${v => setRateText(v)}/>
          <//>
          <div class="pad-b">
            <${Button} full variant="ghost" disabled=${out === null} onClick=${useIt}>
              ${out === null ? '填写金额与汇率' : `折合 ${currency.display(out, cur.code)}，填入金额`}
            <//>
          </div>
        </div>` : null}
      <${Field} label="留言" desc="可以不写。">
        <${Input} value=${note} placeholder="留言" maxlength=${40} onInput=${setNote}/>
      <//>
      <div class="pad-t">
        <${Button} full disabled=${!ok} onClick=${submit}>转账${ok ? ` ${transfer.format(amount)}` : ''}<//>
      </div>
      <div class="settings-foot">
        转账后由对方决定收下或退回。在此之前可以长按该消息将其删除。<br/>
        币种仅影响此后发出的转账，已发出的保持原样。
        换算只在填写金额时进行，存下的是折算之后的数额。
      </div>

      <${Sheet} open=${picking} onClose=${() => setPicking(false)} title="币种" height="68%">
        <${List} inset=${false}>
          ${currency.LIST.map(c => html`
            <${ListItem} key=${c.code} title=${c.name}
              subtitle=${c.symbol ? `${c.symbol} · ${c.code}` : '金额不带符号'}
              right=${c.code === cur.code ? html`<${Icon} name="check" size=${16}/>` : null}
              onClick=${() => { currency.set(c.code); setPicking(false); }}/>`)}
        <//>
        ${currency.pairs().length ? html`
          <${List} title="已填写的汇率" inset=${false}>
            ${currency.pairs().map(r => html`
              <${ListItem} key=${r.key} title=${`${r.fromName} 折 ${r.toName}`}
                subtitle=${`1 : ${r.rate}`}
                right=${html`<button class="nav-text press"
                  onClick=${() => currency.dropRate(r.key)}>删除</button>`}/>`)}
          <//>` : null}
      <//>
    <//>`;
}

// 礼物气泡。**拆开之前只写封面**，里面装什么一个字都不露 —— 界面上不露，
// 上下文里也不露（见 system/gift.js）。
// 拆开之后多一个「收进衣帽间」：角色送的收进我的，我送的收进角色的（system/closet.js 的 fromGift）
export function GiftBubble({ msg, onOpen }) {
  const pending = msg.gift === gift.PENDING;
  const opened = msg.gift === gift.OPENED;
  const actionable = pending && msg.role !== 'user' && onOpen;
  const twist = opened && msg.inner && msg.inner !== msg.cover;
  return html`
    <div class=${`bubble bubble-gift ph-gift${pending ? '' : ' is-done'}`}
      onClick=${actionable ? () => onOpen(msg) : null}>
      <div class="tr-top">
        <${Icon} name="gift" size=${20}/>
        <div class="tr-body">
          <div class="gift-cover ellipsis">${msg.cover}</div>
          ${twist ? html`<div class="gift-inner ellipsis">里面是 ${msg.inner}</div>` : null}
        </div>
      </div>
      <div class="tr-foot">
        ${gift.stateLabel(msg.gift)}${actionable ? ' · 点击拆开' : ''}
        ${opened ? html`
          <button class="gift-closet press" onClick=${e => {
            e.stopPropagation();
            phone.intent.open('closet', { route: `/gift/${msg.id}`, back: true });
          }}>${phone.closet.giftItem(msg.id) ? '在衣帽间中查看' : '收进衣帽间'}</button>` : null}
      </div>
    </div>`;
}

// 送礼物
export function GiftSheet({ open, chatId, onClose }) {
  const s = useStore(db.settings.store);
  const [cover, setCover] = useState('');
  const [inner, setInner] = useState('');

  const close = () => { setCover(''); setInner(''); onClose(); };
  const submit = () => {
    try { gift.send({ chatId, role: 'user', authorId: 'me', cover, inner }); close(); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${Sheet} open=${open} onClose=${close} title="送礼物">
      <${Field} label="封面上写什么" desc="对方拆开之前看到的就是这个名称。">
        <${Input} value=${cover} placeholder="礼物名称" maxlength=${40} onInput=${setCover}/>
      <//>
      <${Field} label="拆开是什么"
        desc="可以和封面不一样。留空表示表里如一。">
        <${Input} value=${inner} placeholder=${cover || '实际装的东西'}
          maxlength=${60} onInput=${setInner}/>
      <//>
      <div class="pad-t">
        <${Button} full disabled=${!cover.trim()} onClick=${submit}>送出<//>
      </div>

      <${List} inset=${false}>
        <${ListItem} title="拆开前保密" multiline
          subtitle=${s.giftBlind === false
            ? '已关闭。角色收到时就知道里面是什么，反应更连贯，但没有惊喜'
            : '角色拆开之前不知道里面装的是什么，拆开后才会知道'}
          right=${html`<${Switch} checked=${s.giftBlind !== false}
            onChange=${v => db.settings.set({ giftBlind: v })}/>`}/>
      <//>
      <div class="settings-foot">
        此设置对所有对话生效。对方送来的礼物不受影响，你始终是拆开后才看到内容。
      </div>
    <//>`;
}

// 拆开或拒收
export function UnwrapSheet({ msg, onClose }) {
  if (!msg) return null;
  const chat = db.chats.get(msg.chatId);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  const act = open => { gift.settle(msg.id, open); onClose(); };
  return html`
    <${Sheet} open=${!!msg} onClose=${onClose}
      title=${`${phone.remark.nameOf(char) || '对方'}送来「${msg.cover}」`}>
      <${List} inset=${false}>
        <${ListItem} title="拆开" arrow
          left=${html`<${Icon} name="gift" size=${18}/>`} onClick=${() => act(true)}/>
        <${ListItem} title="拒收" arrow
          left=${html`<${Icon} name="reply" size=${18}/>`} onClick=${() => act(false)}/>
      <//>
      <div class="settings-foot">拆开之前不会显示里面是什么。</div>
    <//>`;
}

// 一起听的记录。整场只留这一条，和通话记录同构。
export function ListenBubble({ msg, onOpen }) {
  const n = (msg.trackIds || []).length;
  return html`
    <div class="bubble bubble-call" onClick=${onOpen ? () => onOpen(msg) : null}>
      <${Icon} name="music" size=${18}/>
      <span>${`一起听了 ${listen.fmt(msg.seconds)} · ${n} 首`}</span>
    </div>`;
}

// 分享的一首歌。卡片上是封面、歌名、歌手，点一下就放，并进「正在播放」看歌词。
// 歌是落卡片之后才去找的（曲库，再网易云），找的那一两秒写「正在找」，
// 两处都没有就照实写，不假装能放
export function SongBubble({ msg }) {
  return html`<${SongCard} songId=${msg.songId} query=${msg.songQuery} state=${msg.songState}
    cls="bubble-song"/>`;
}

// 一起看的记录。和一起听同构，只是这一条不列曲目，列的是看到哪儿。
export function WatchBubble({ msg }) {
  const row = db.videos.get(msg.videoId);
  const [first, second] = String(msg.content || '').split('\n');
  return html`
    <div class="bubble bubble-call">
      <${Icon} name="film" size=${18}/>
      <span>${(first || '').replace(/^\[|\]$/g, '')}${second ? `　${row ? row.title : second}` : ''}</span>
    </div>`;
}

// 一起读留下的那一条。和 WatchBubble 同一个样子
export function ReadBubble({ msg }) {
  const [first, second] = String(msg.content || '').split('\n');
  return html`
    <div class="bubble bubble-call">
      <${Icon} name="book" size=${18}/>
      <span>${(first || '').replace(/^\[|\]$/g, '')}${second ? `　${second}` : ''}</span>
    </div>`;
}

// 书摘卡片。自己读书时摘的一小段，发过来的一条消息
export function ExcerptBubble({ msg }) {
  return html`
    <div class="xc-card">
      <div class="xc-from">
        摘自《${msg.bookTitle || '一本书'}》${msg.bookAuthor ? ` · ${msg.bookAuthor}` : ''}
      </div>
      <p class="xc-quote">${msg.quote || ''}</p>
      ${msg.note ? html`<p class="xc-note">${msg.note}</p>` : null}
    </div>`;
}

export function ListenLogSheet({ msg, onClose }) {
  if (!msg) return null;
  const tracks = (msg.trackIds || []).map(id => db.songs.get(id)).filter(Boolean);
  return html`
    <${Sheet} open=${!!msg} onClose=${onClose}
      title=${`一起听了 ${listen.fmt(msg.seconds)}`} height="60%">
      ${tracks.length ? html`
        <${List} inset=${false}>
          ${tracks.map((t, i) => html`
            <${ListItem} key=${i} title=${t.title} subtitle=${t.artist || ''}/>`)}
        <//>`
      : html`<div class="settings-foot">这些歌已经不在曲库里了。</div>`}
    <//>`;
}

// 会话顶上的播放条。一起听是边聊边听，不该像通话那样把整页盖住。
// 一起看那一场还开着的时候，会话顶上留一条。
//
// 没有它的话，人从播放页退出来，这一场在后台还开着，**界面上一点痕迹都没有**，
// 只有 prompt 里还写着「你们正在看」。要么回得去，要么收得掉，不能只剩 prompt 知道。
export function WatchBar({ chatId }) {
  const s = useStore(watch.watch);
  useStore(db.videos.store);
  if (!s.active || s.chatId !== chatId) return null;
  const row = watch.current();

  return html`
    <div class="listen-bar">
      <button class="listen-key press" aria-label="回到播放页"
        onClick=${() => phone.intent.open('theater', { route: `/watch/${chatId}` })}>
        <${Icon} name="film" size=${16}/></button>
      <div class="listen-main" onClick=${() => phone.intent.open('theater', { route: `/watch/${chatId}` })}>
        <div class="listen-title ellipsis">${row?.title || '一起看'}</div>
        <div class="listen-sub ellipsis">
          ${s.awayAt ? '已暂停，点此回到播放页' : `看到 ${subtitle.stamp(s.at)}`}
          ${` · 本次 ${watch.fmt(s.seconds)}`}
        </div>
      </div>
      <button class="listen-key press" aria-label="结束一起看" onClick=${() => watch.stop()}>
        <${Icon} name="close" size=${16}/></button>
    </div>`;
}

// 点中间那一块进「正在播放」看大封面与歌词（和音乐 app 同一页）；歌单在那一页右上角
export function ListenBar({ chatId }) {
  const s = useStore(listen.listen);
  useStore(db.songs.store);
  if (!s.active || s.chatId !== chatId) return null;
  const song = listen.current();
  const line = listen.lyricNow();

  return html`
    <div class="listen-bar">
      <button class="listen-key press" aria-label=${s.playing ? '暂停' : '播放'}
        onClick=${listen.toggle}>
        <${Icon} name=${s.playing ? 'minus' : 'chevronRight'} size=${16}/></button>
      <div class="listen-main"
        onClick=${() => (s.blocked ? listen.toggle() : phone.intent.open('music', { route: '/now/listen', back: true }))}>
        <div class="listen-title ellipsis">${music.label(song) || '一起听'}</div>
        <div class="listen-sub ellipsis">
          ${s.error || line || `${listen.clock(s.at)} · 本次 ${listen.fmt(s.seconds)}`}
        </div>
      </div>
      <button class="listen-key press" aria-label="下一首" onClick=${listen.next}>
        <${Icon} name="chevronRight" size=${16}/></button>
      <button class="listen-key press" aria-label="结束一起听" onClick=${() => listen.stop()}>
        <${Icon} name="close" size=${16}/></button>
    </div>`;
}

// 位置气泡。虚拟定位，不读设备 GPS，也不查地图接口，就是一个地点名加一行地址。
export function LocationBubble({ msg }) {
  return html`
    <div class="bubble bubble-location ph-location">
      <div class="loc-body">
        <div class="loc-name ellipsis">${msg.place}</div>
        ${msg.address ? html`<div class="loc-addr ellipsis">${msg.address}</div>` : null}
      </div>
      <div class="loc-map"><${Icon} name="map" size=${22}/></div>
    </div>`;
}

// 通话记录。整通电话只留这一条，点开看全文。
export function CallBubble({ msg, onOpen }) {
  const done = msg.outcome === 'done';
  return html`
    <div class=${`bubble bubble-call ph-call${done ? '' : ' is-miss'}`}
      onClick=${done && onOpen ? () => onOpen(msg) : null}>
      <${Icon} name=${msg.callKind === 'video' ? 'film' : 'phone'} size=${18}/>
      <span>${call.label(msg.direction, msg.outcome, msg.seconds, msg.callKind === 'video')}</span>
    </div>`;
}

// 通话全文
// 一句话的声音。一轮可能合成了好几段（按句切的），依次接着放
function LinePlay({ ids }) {
  const [on, setOn] = useState(false);
  const ref = useRef(null);
  useEffect(() => () => { ref.current?.pause(); }, []);
  const play = async () => {
    if (on) { ref.current?.pause(); setOn(false); return; }
    setOn(true);
    for (const id of ids) {
      const url = await db.files.url(id).catch(() => null);
      if (!url) continue;
      const a = new Audio(url);
      ref.current = a;
      const ended = await new Promise(res => { a.onended = () => res(true); a.onpause = () => res(false);
        a.onerror = () => res(true); a.play().catch(() => res(true)); });
      if (!ended) break;
    }
    ref.current = null;
    setOn(false);
  };
  return html`<button class="log-play press" onClick=${play} aria-label=${on ? '停止' : '播放这一句'}>
    <${Icon} name=${on ? 'pause' : 'play'} size=${13}/></button>`;
}

/**
 * 通话记录。
 *
 * 原文、译文、每一句的声音、总结，以及整通电话的声音下载。
 * 声音只有走语音接口合成的那几句才有 —— 浏览器自带那档是现念的，
 * 自己说的话是现场识别的，都没有文件可存。界面上照实说。
 */
export function CallLogSheet({ msg, onClose }) {
  useStore(db.messages.store);
  const [summing, setSumming] = useState(false);
  if (!msg) return null;
  const fresh = db.messages.get(msg.id) || msg;
  const chat = db.chats.get(fresh.chatId);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  const me = phone.accounts.current()?.name || '我';
  const lines = fresh.callLog || [];
  const voiced = lines.some(l => (l.audio || []).length);

  const sum = async () => {
    setSumming(true);
    try { await call.summarize(fresh.id); }
    catch (err) { toast(String(err.message || err), 'error', 4000); }
    finally { setSumming(false); }
  };
  const download = async () => {
    const blob = await call.wholeAudio(fresh.id);
    if (!blob) { toast('这通电话没有可下载的声音'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${phone.remark.nameOf(char) || '通话'}-${new Date(fresh.createdAt || Date.now())
      .toISOString().slice(0, 16).replace(/[:T]/g, '')}.mp3`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return html`
    <${Sheet} open=${!!msg} onClose=${onClose}
      title=${call.label(fresh.direction, fresh.outcome, fresh.seconds, fresh.callKind === 'video')} height="80%">
      ${lines.length ? html`
        <div class="pad-x">
          <div class="log-sum">
            ${fresh.callSummary
    ? html`<div class="log-sum-text">${fresh.callSummary}</div>`
    : html`<div class="log-sum-empty">尚未生成总结。</div>`}
            <div class="btn-row">
              <${Button} size="sm" variant="ghost" icon="sparkle" disabled=${summing} onClick=${sum}>
                ${summing ? '正在生成' : (fresh.callSummary ? '重新生成总结' : '生成总结')}<//>
              ${voiced ? html`
                <${Button} size="sm" variant="ghost" icon="download" onClick=${download}>下载整通语音<//>` : null}
            </div>
          </div>
          ${lines.map((l, i) => html`
            <div key=${i} class="log-line">
              <span class="log-who">${l.role === 'user' ? me : (phone.remark.nameOf(char) || '对方')}</span>
              <span class="log-body">
                <span class="log-text">${l.text}</span>
                ${l.trans ? html`<span class="log-trans">${l.trans}</span>` : null}
              </span>
              ${(l.audio || []).length ? html`<${LinePlay} ids=${l.audio}/>` : null}
            </div>`)}
          ${voiced ? null : html`
            <div class="settings-foot">
              这通电话没有保存声音。只有在通话中打开喇叭、且通过语音接口合成的句子才会保存；
              浏览器自带的合成与你自己说的话没有文件。
            </div>`}
        </div>`
      : html`<div class="settings-foot">这通电话没有留下内容。</div>`}
    <//>`;
}

// 发送位置
export function LocationSheet({ open, chatId, onClose }) {
  const [name, setName] = useState('');
  const [addr, setAddr] = useState('');

  const close = () => { setName(''); setAddr(''); onClose(); };
  const submit = () => {
    try { place.send({ chatId, role: 'user', authorId: 'me', place: name, address: addr }); close(); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${Sheet} open=${open} onClose=${close} title="位置">
      <${Field} label="地点名称" desc="招牌上的名字，例如「城市图书馆」。">
        <${Input} value=${name} placeholder="地点名称" maxlength=${40} onInput=${setName}/>
      <//>
      <${Field} label="详细地址" desc="可以不写。">
        <${Input} value=${addr} placeholder="街道与门牌" maxlength=${80} onInput=${setAddr}/>
      <//>
      <div class="pad-t">
        <${Button} full disabled=${!name.trim()} onClick=${submit}>发送位置<//>
      </div>
      <div class="settings-foot">
        发送的是自行填写的地点，不会读取本机定位，也不会连接任何地图服务。
      </div>
    <//>`;
}

// 收下或退回
export function SettleSheet({ msg, onClose }) {
  if (!msg) return null;
  const char = db.characters.get(msg.authorId);
  const act = take => {
    transfer.settle(msg.id, take);
    onClose();
  };
  return html`
    <${Sheet} open=${!!msg} onClose=${onClose}
      title=${`${phone.remark.nameOf(char) || '对方'}转来 ${transfer.format(msg.amount)}`}>
      ${msg.note ? html`<div class="settings-foot">留言：${msg.note}</div>` : null}
      <${List} inset=${false}>
        <${ListItem} title="收款" arrow
          left=${html`<${Icon} name="check" size=${18}/>`} onClick=${() => act(true)}/>
        <${ListItem} title="退回" arrow
          left=${html`<${Icon} name="reply" size=${18}/>`} onClick=${() => act(false)}/>
      <//>
      <div class="settings-foot">处理结果会告知对方。</div>
    <//>`;
}

// ---- 情侣账户与亲属卡（4.278）----
//
// 四件事共用一张气泡：开设情侣账户、存入情侣账户、动用情侣账户、发亲属卡。
// 前一件与后两件是同一个形状（A 提出，B 通过或驳回）；存入发出即落定，气泡上只写「已存入」。

export function RequestBubble({ msg, onVote }) {
  const mine = msg.role === 'user';
  const pending = msg.request === request.PENDING;
  const actionable = pending && !mine && onVote;
  const k = msg.requestKind;
  const title = k === request.JOINT ? '开设情侣账户'
    : k === request.CARD ? `亲属卡　额度 ${request.display(msg.amount, msg.currency)}`
    : k === request.DEPOSIT ? `存入情侣账户　${request.display(msg.amount, msg.currency)}`
    : `动用情侣账户　${request.display(msg.amount, msg.currency)}`;
  return html`
    <div class=${`bubble bubble-transfer${pending ? '' : ' is-done'}`}
      onClick=${actionable ? () => onVote(msg) : null}>
      <div class="tr-top">
        <${Icon} name=${k === request.CARD ? 'gift' : k === request.DEPOSIT ? 'wallet' : 'users'} size=${20}/>
        <div class="tr-body">
          <div class="tr-amount bl-req-title">${title}</div>
          ${msg.note && (k === request.SPEND || k === request.DEPOSIT)
            ? html`<div class="tr-note ellipsis">${msg.note}</div>` : null}
        </div>
      </div>
      <div class="tr-foot">
        ${request.stateLabel(msg.request, k)}${actionable ? ' · 点击处理' : ''}
      </div>
    </div>`;
}

export function VoteSheet({ msg, onClose }) {
  if (!msg) return null;
  const char = db.characters.get(msg.authorId);
  const k = msg.requestKind;
  const what = k === request.JOINT ? '开设情侣账户'
    : k === request.CARD ? `开出一张额度 ${request.format(msg.amount, msg.currency)} 的亲属卡`
    : `动用情侣账户 ${request.format(msg.amount, msg.currency)}`;
  const act = ok => { request.settle(msg.id, ok); onClose(); };
  return html`
    <${Sheet} open=${!!msg} onClose=${onClose} title=${`${phone.remark.nameOf(char) || '对方'}申请${what}`}>
      ${msg.note && k === request.SPEND
        ? html`<div class="settings-foot">用途：${msg.note}</div>` : null}
      <${List} inset=${false}>
        <${ListItem} title="通过" arrow
          left=${html`<${Icon} name="check" size=${18}/>`} onClick=${() => act(true)}/>
        <${ListItem} title="驳回" arrow
          left=${html`<${Icon} name="close" size=${18}/>`} onClick=${() => act(false)}/>
      <//>
      <div class="settings-foot">
        ${k === request.JOINT
          ? '通过后会在关联的账本中建立情侣账户。双方均可存入，动用需对方批准。'
          : k === request.CARD
            ? '通过后，你消费时将在额度内从对方余额扣除。额度用尽后恢复从本人余额扣除。'
            : '通过后，该金额从情侣账户扣除。'}
      </div>
    <//>`;
}

/** 发起申请。四种共用一张，选哪一种决定要不要填金额。 */
export function RequestSheet({ open, chatId, onClose }) {
  const [kind, setKind] = useState(request.SPEND);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const book = ledger.bookOfChat(chatId);
  const joint = book && ledger.hasJoint(book.id);

  const close = () => { setAmount(''); setNote(''); onClose(); };
  const submit = () => {
    try {
      // 存入：发出即落定，先看自己的钱够不够（第二道关，和转账同一条）
      if (cur === request.DEPOSIT && !ledger.affordable(chatId, ledger.ME, amount)) {
        throw new Error('余额不足，存不了这么多');
      }
      request.send({ chatId, role: 'user', authorId: 'me', kind: cur, amount, note });
      close();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const kinds = [
    ...(joint ? [] : [{ value: request.JOINT, label: '开设情侣账户' }]),
    ...(joint ? [{ value: request.DEPOSIT, label: '存入' }, { value: request.SPEND, label: '动用' }] : []),
    { value: request.CARD, label: '亲属卡' },
  ];
  const cur = kinds.some(x => x.value === kind) ? kind : kinds[0].value;
  const needAmount = cur !== request.JOINT;
  const ok = !!book && (!needAmount || request.money(amount) > 0);
  const mine = book ? ledger.defaultFor(book.id, ledger.ME) : null;

  // 没关联账本就发不出去：角色那边只有关联了账本才知道这套写法，发过去它只能用文字回应，
  // 申请永远停在待处理（4.278）。这里直接把人带去建一本
  const bind = () => { close(); intent.open('bill', { route: `/books/new/${chatId}`, back: true }); };

  return html`
    <${Sheet} open=${open} onClose=${close} title="申请">
      ${!book ? html`
        <div class="settings-foot">
          这段对话还没有关联账本。情侣账户、亲属卡与申请都记在账本上，需要先建立一本并关联该对话。
        </div>
        <div class="pad">
          <${Button} full onClick=${bind}>建立账本并关联这段对话<//>
        </div>` : null}

      <div class="pad-b">
        <${Segmented} value=${cur} items=${kinds} onChange=${setKind}/>
      </div>

      ${needAmount ? html`
        <${Field} label=${cur === request.CARD ? '额度' : '金额'}
          desc=${cur === request.DEPOSIT && mine
            ? `从本人的钱包存入。当前余额 ${ledger.money(book.id, ledger.balanceOf(book.id, mine.id))}` : ''}>
          <${Input} value=${amount} type="number" inputmode="decimal"
            placeholder="0" onInput=${setAmount}/>
        <//>` : null}

      ${cur === request.SPEND || cur === request.DEPOSIT ? html`
        <${Field} label="用途" desc="可以不写。">
          <${Input} value=${note} placeholder="用途" maxlength=${40} onInput=${setNote}/>
        <//>` : null}

      <div class="pad-t">
        <${Button} full disabled=${!ok} onClick=${submit}>${cur === request.DEPOSIT ? '存入' : '发出申请'}<//>
      </div>
      <div class="settings-foot">
        ${cur === request.JOINT
          ? '对方通过后，账本中会建立情侣账户。双方均可存入，动用需对方批准。'
          : cur === request.DEPOSIT
            ? '发出即存入，不需要对方批准。金额从本人的钱包转入情侣账户。'
          : cur === request.CARD
            ? '对方通过后，对方消费时将在额度内从你的余额扣除。额度用尽后恢复从对方余额扣除。'
            : '对方通过后，该金额从情侣账户扣除。'}
      </div>
    <//>`;
}
