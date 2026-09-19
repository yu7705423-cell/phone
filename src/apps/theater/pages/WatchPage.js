import { html, useState, useRef, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, EmptyState, toast, confirm } from '../../../ui/index.js';

const { db, nav, video, watch, subtitle, ai, uid } = phone;

// 一起看。
//
// **是她陪你看，不是两块屏幕对时间。** 角色那边没有第二个播放器，所以这里
// 不做房间、不做同步，只把「演到哪儿、刚说了什么」摆到她面前，见 system/watch.js。
//
// 什么时候让她开口，由 watch.due() 判断：间隔到了，而且这一带不是正演着
// 对手戏。判据是字幕的疏密，本地算，不花钱。

function Picker({ chatId, char }) {
  useStore(db.videos.store);
  const list = video.allVideos();
  const total = watch.totals(chatId);

  const start = row => {
    try {
      watch.start({ chatId, videoId: row.id });
      db.messages.create({
        chatId, role: 'user', authorId: 'me', kind: 'notice',
        content: `[开始一起看《${row.title}》]`, status: 'done',
      });
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${Page} title="一起看" onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => nav.push('/videos')}>片库</button>`}>
      <${List} title="一起看了多久">
        <${ListItem} title="累积" multiline
          subtitle=${total.count
            ? `和${char?.name || '对方'}一共看了 ${watch.fmt(total.seconds)}，${total.count} 次`
            : '还没有一起看过'}/>
      <//>

      ${list.length ? html`
        <${List} title=${`片库 · ${list.length} 部`}>
          ${list.map(row => {
            const n = video.linesOf(row).length;
            return html`
              <${ListItem} key=${row.id} title=${row.title} multiline arrow
                subtitle=${video.hasSubtitle(row)
                  ? `字幕 ${n} 句${(row.outline || []).length ? ' · 已有剧情提纲' : ''}`
                  : '没有字幕。角色将只知道进度，不知道演了什么'}
                left=${html`<${Icon} name="film" size=${18}/>`}
                onClick=${() => start(row)}/>`;
          })}
        <//>`
      : html`
        <${EmptyState} icon="film" title="片库是空的"
          desc="先在片库中添加一部影片并导入字幕，再回到这里开始。"
          action=${html`<${Button} size="sm" icon="plus"
            onClick=${() => nav.push('/videos')}>前往片库<//>`}/>`}

      <div class="settings-foot">
        角色看不到画面，它读到的是字幕。没有字幕的影片也能一起看，
        但角色只知道当前进度。
      </div>
    <//>`;
}

function Screen({ chatId, chat, char }) {
  const s = useStore(watch.watch);
  const ref = useRef(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useStore(db.messages.store);
  // 片库那条记录也要订阅：字幕偏移就写在它上面，改完这一屏要立刻跟着变
  useStore(db.videos.store);

  const row = watch.current();
  const lines = video.linesOf(row);
  const cue = subtitle.lineAt(lines, s.at);
  const off = video.offsetOf(row);

  // 字幕对不上是常事，而**只有正在看的时候才发现**。所以调整放在这一屏上，
  // 不必退出去改片库。改完立刻生效：偏移是读出来的时候才加的。
  const nudge = d => {
    try { video.updateVideo(row.id, { offset: off + d }); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };

  // 把 <video> 交给 watch：标记里那几行（暂停、继续、倒回）要控制得到它
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let alive = true;
    video.srcOf(row).then(src => {
      if (!alive || !src) return;
      el.src = src;
      el.play().catch(() => {});
    });
    watch.attach(el);
    return () => { alive = false; watch.detach(); };
  }, [row?.id]);

  async function generate() {
    if (busyRef.current || !ai.isConfigured()) return;
    busyRef.current = true; setBusy(true);
    try {
      const raw = await ai.streamReply({ chat, char });
      const clean = String(raw || '').trim();
      if (clean) {
        await ai.reply.renderTurn({ chat, char, raw: clean, turnId: uid('turn') });
        watch.markSaid();
      }
    } catch (err) {
      if (!ai.queue.isAbort(err)) toast(String(err.message || err), 'error', 4000);
    } finally { busyRef.current = false; setBusy(false); }
  }

  // 到点了就让她说一句。每五秒问一次 watch.due()，判断在那边。
  useEffect(() => {
    const t = setInterval(() => { if (watch.due()) generate(); }, 5000);
    return () => clearInterval(t);
  }, [chatId]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    db.messages.create({ chatId, role: 'user', authorId: 'me', kind: 'text',
      content: text, status: 'done' });
    db.chats.update(chatId, { lastMessageAt: Date.now() });
    generate();
  };

  const finish = async () => {
    if (!await confirm({ title: '结束一起看', message: '将记录本次观看的时长与进度。', okText: '结束' })) return;
    watch.stop();
  };

  const recent = db.messagesOf(chatId).filter(m => m.kind === 'text' || m.kind === 'notice').slice(-6);

  // 新的一条出来就滚到底
  const msgsRef = useRef(null);
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [recent.length, busy]);

  return html`
    <${Page} title=${row?.title || '一起看'} onBack=${nav.pop} noScroll
      right=${html`<button class="nav-text press" onClick=${finish}>结束</button>`}>
      <div class="wt">
        <div class="wt-stage">
          <video ref=${ref} class="wt-video" playsinline
            onClick=${() => watch.toggle()}></video>
          ${cue ? html`<div class="wt-cue">${cue}</div>` : null}
        </div>

        <div class="wt-bar">
          <button class="mu-ctl press" aria-label=${s.playing ? '暂停' : '播放'}
            onClick=${() => watch.toggle()}>
            <${Icon} name=${s.playing ? 'pause' : 'play'} size=${19}/>
          </button>
          <button class="mu-ctl press" aria-label="后退十五秒"
            onClick=${() => watch.seek(s.at - 15)}>
            <${Icon} name="skipPrev" size=${19}/>
          </button>
          <div class="wt-line" onClick=${e => {
            const box = e.currentTarget.getBoundingClientRect();
            if (s.duration) watch.seek(((e.clientX - box.left) / box.width) * s.duration);
          }}>
            <i style=${`width:${s.duration ? Math.min(100, (s.at / s.duration) * 100) : 0}%`}></i>
          </div>
          <span class="wt-time">${subtitle.stamp(s.at)}</span>
        </div>

        ${lines.length ? html`
          <div class="wt-sync">
            <span>字幕</span>
            <button class="press" aria-label="字幕提前半秒" onClick=${() => nudge(-0.5)}>提前</button>
            <b>${off > 0 ? `+${off}` : off} 秒</b>
            <button class="press" aria-label="字幕推迟半秒" onClick=${() => nudge(0.5)}>推迟</button>
            ${off ? html`<button class="press" onClick=${() => nudge(-off)}>归零</button>` : null}
          </div>` : null}

        <div class="wt-msgs" ref=${msgsRef}>
          ${recent.map(m => html`
            <div key=${m.id} class=${`wt-msg${m.role === 'user' ? ' is-me' : ''}`}>
              ${m.kind === 'notice'
                ? html`<span class="wt-notice">${String(m.content).replace(/^\[|\]$/g, '')}</span>`
                : m.content}
            </div>`)}
          ${busy ? html`<div class="wt-msg"><span class="wt-notice">正在输入</span></div>` : null}
        </div>

        <div class="wt-input">
          <input value=${draft} placeholder="说点什么" enterkeyhint="send"
            onInput=${e => setDraft(e.target.value)}
            onKeyDown=${e => { if (e.key === 'Enter') send(); }}/>
          <button class="mu-ctl press" aria-label="发送" onClick=${send}>
            <${Icon} name="send" size=${18}/>
          </button>
        </div>
      </div>
    <//>`;
}

export function WatchPage({ chatId }) {
  useStore(watch.watch);
  const chat = db.chats.get(chatId);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  if (!chat || !char) {
    return html`<${Page} title="一起看" onBack=${nav.pop}>
      <${EmptyState} title="该会话已不存在"/><//>`;
  }
  return watch.inChat(chatId)
    ? html`<${Screen} chatId=${chatId} chat=${chat} char=${char}/>`
    : html`<${Picker} chatId=${chatId} char=${char}/>`;
}
