import { html, useState, useEffect, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Avatar, Icon, IconButton } from '../../../ui/index.js';

const { db, call } = phone;

// 通话界面。盖住整个会话页。
//
// 字幕是主角：默认不发声，屏幕中间一句一句往上走。想听声音点开喇叭。
function Lines({ lines, draft, thinking, me, char }) {
  const boxRef = useRef(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, draft, thinking]);

  return html`
    <div class="call-lines scroll" ref=${boxRef}>
      ${lines.map((l, i) => html`
        <div key=${i} class=${`call-line${l.role === 'user' ? ' is-mine' : ''}`}>
          <span class="call-who">${l.role === 'user' ? me : char}</span>
          <span class="call-text">${l.text}</span>
        </div>`)}
      ${draft ? html`
        <div class="call-line">
          <span class="call-who">${char}</span>
          <span class="call-text">${draft}</span>
        </div>` : null}
      ${thinking ? html`<div class="call-line"><span class="spinner"></span></div>` : null}
    </div>`;
}

export function CallScreen() {
  const s = useStore(call.call);
  const [draft, setDraft] = useState('');
  const char = db.characters.get(s.charId);
  const avatar = useImage(char?.avatar);
  const me = phone.accounts.current()?.name || '我';

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    call.say(t);
  };

  const status = s.phase === 'dialing' ? '正在呼叫'
    : s.phase === 'ringing' ? '邀请你进行语音通话'
    : call.duration(s.seconds);

  return html`
    <div class="call-layer">
      <div class="call-head">
        <${Avatar} src=${avatar} name=${char?.name} size=${84} radius=${42}/>
        <div class="call-name">${char?.name || '通话'}</div>
        <div class="call-status">${status}</div>
        ${s.error ? html`<div class="call-error">${s.error}</div>` : null}
      </div>

      ${s.phase === 'active' ? html`
        <${Lines} lines=${s.lines} draft=${s.draft} thinking=${s.thinking}
          me=${me} char=${char?.name || '对方'}/>` : html`<div class="call-lines"></div>`}

      ${s.phase === 'active' && s.mic ? html`
        <div class="call-heard">${s.heard || (s.listening ? '正在聆听' : '麦克风未启用')}</div>` : null}

      ${s.phase === 'active' && !s.mic ? html`
        <div class="call-input">
          <input value=${draft} placeholder="输入要说的话"
            onInput=${e => setDraft(e.target.value)}
            onKeyDown=${e => { if (e.key === 'Enter') send(); }}/>
          <button class="press" aria-label="发送" onClick=${send}
            disabled=${!draft.trim()}><${Icon} name="send" size=${18}/></button>
        </div>` : null}

      <div class="call-bar">
        ${s.phase === 'ringing' ? html`
          <button class="call-key is-hang press" onClick=${call.decline} aria-label="拒接">
            <${Icon} name="close" size=${24}/></button>
          <button class="call-key is-take press" onClick=${call.accept} aria-label="接听">
            <${Icon} name="phone" size=${24}/></button>`
        : html`
          <button class=${`call-key press${s.speak ? ' is-on' : ''}`}
            onClick=${call.toggleSpeak} aria-label=${s.speak ? '关闭声音' : '开启声音'}>
            <${Icon} name="headphone" size=${22}/></button>
          <button class="call-key is-hang press" onClick=${call.hangUp} aria-label="挂断">
            <${Icon} name="close" size=${24}/></button>
          <button class=${`call-key press${s.mic ? ' is-on' : ''}`}
            onClick=${call.toggleMic} aria-label=${s.mic ? '改为输入文字' : '改用语音'}>
            <${Icon} name="mic" size=${22}/></button>`}
      </div>

      <div class="call-foot">
        ${s.phase === 'ringing' ? '接听后开始通话'
          : s.mic ? (s.speak ? '语音输入与声音均已开启' : '语音输入已开启，仅显示字幕')
          : s.speak ? '声音已开启，通过输入框说话'
          : '仅显示字幕。左侧按钮开启声音，右侧按钮改用语音'}
      </div>
    </div>`;
}
