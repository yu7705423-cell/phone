import { html, useState, useEffect, useRef } from '../lib.js';
import { useStore } from '../system/store.js';
import { characters } from '../system/db/index.js';
import { useImage } from '../system/db/useImage.js';
import * as call from '../system/call.js';
import * as accounts from '../system/accounts.js';
import * as camera from '../system/camera.js';
import { Avatar, Icon } from '../ui/index.js';

// 通话界面。挂在外壳上而不是聊天 app 里 —— 电话要能盖住任何页面，
// 在主界面、在别的 app、在锁屏上接到都是同一回事。

function Lines({ lines, draft, thinking, me, char, onDark }) {
  const boxRef = useRef(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, draft, thinking]);

  return html`
    <div class=${`call-lines scroll${onDark ? ' on-dark' : ''}`} ref=${boxRef}>
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

// 我这边的小窗。虚拟就是一张头像，真实就是摄像头。
function SelfView({ real, avatar, name }) {
  const videoRef = useRef(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    el.srcObject = camera.current();
    el.play().catch(() => {});
    camera.attach(el);
    return () => camera.detach(el);
  }, [real]);

  return html`
    <div class="call-self">
      ${real
        ? html`<video ref=${videoRef} playsinline muted autoplay></video>`
        : html`<${Avatar} src=${avatar} name=${name} size=${96} radius=${0}/>`}
    </div>`;
}

export function CallLayer() {
  const s = useStore(call.call);
  const [draft, setDraft] = useState('');
  // 没在打电话的时候什么都不查。这一层挂在外壳上，每次外壳重画它都要跑一遍，
  // 而且它在 ErrorBoundary 外面 —— 空转时多碰一个模块，就多一处能把整个外壳
  // 拖垮的地方。hook 还是照常调，顺序不能变。
  const live = s.phase !== 'idle';
  const char = live ? characters.get(s.charId) : null;
  // 开着喇叭却出不来「这个角色的声音」时，说清楚是哪一环没对
  const why = live ? call.voiceWhy(char) : '';
  const me = live ? accounts.current() : null;
  const avatar = useImage(char?.avatar);
  const scene = useImage(char?.callImage);
  const myFace = useImage(me?.avatar);
  if (!live) return null;

  const video = s.video;
  const send = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    call.say(t);
  };

  const what = video ? '视频通话' : '语音通话';
  const status = s.phase === 'dialing' ? '正在呼叫'
    : s.phase === 'ringing' ? `邀请你进行${what}`
    : call.duration(s.seconds);

  // 视频通话把对方铺满整个屏幕：有专门上传的画面就用它，没有就拿头像顶上。
  // 两样都没有（头像本来就是个首字）就退回语音那套版式 —— 铺一块空白不如
  // 老老实实把那个首字放中间。
  const back = video ? (scene || avatar) : null;
  const dark = video && !!back;

  return html`
    <div class=${`call-layer${dark ? ' is-video' : ''}`}>
      ${back ? html`<div class="call-back" style=${`background-image:url(${back})`}></div>` : null}
      ${dark ? html`<div class="call-scrim"></div>` : null}

      <div class="call-head">
        ${dark ? null : html`<${Avatar} src=${avatar} name=${char?.name} size=${84} radius=${42}/>`}
        <div class="call-name">${char?.name || '通话'}</div>
        <div class="call-status">${status}</div>
        ${s.error ? html`<div class="call-error">${s.error}</div>` : null}
      </div>

      ${video && s.phase !== 'ringing' ? html`
        <${SelfView} real=${s.selfReal && s.camera} avatar=${myFace} name=${me?.name}/>` : null}

      ${s.phase === 'active' ? html`
        <${Lines} lines=${s.lines} draft=${s.draft} thinking=${s.thinking}
          me=${me?.name || '我'} char=${char?.name || '对方'} onDark=${dark}/>`
        : html`<div class="call-lines"></div>`}

      ${s.phase === 'active' && s.mic ? html`
        <div class="call-heard">${s.heard || (s.listening ? '正在聆听' : '麦克风未启用')}</div>` : null}

      ${s.phase === 'active' && s.speak && why ? html`
        <div class="call-why">${why}</div>` : null}

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
          ${video ? html`
            <button class=${`call-key press${s.selfReal ? ' is-on' : ''}`}
              onClick=${call.toggleSelf}
              aria-label=${s.selfReal ? '改用虚拟画面' : '改用真实画面'}>
              <${Icon} name="camera" size=${22}/></button>` : null}
          <button class="call-key is-hang press" onClick=${call.hangUp} aria-label="挂断">
            <${Icon} name="close" size=${24}/></button>
          <button class=${`call-key press${s.mic ? ' is-on' : ''}`}
            onClick=${call.toggleMic} aria-label=${s.mic ? '改为输入文字' : '改用语音'}>
            <${Icon} name="mic" size=${22}/></button>`}
      </div>

      <div class="call-foot">
        ${s.phase === 'ringing' ? '接听后开始通话'
          : video && s.selfReal
            ? (call.charCanSee()
              ? '正在使用摄像头，角色可以看到你的画面'
              : '正在使用摄像头。角色看不到画面，需在「设置 - 识图」中选择「交给聊天模型」')
          : video ? '当前使用虚拟画面，角色看不到你的摄像头'
          : s.speak ? '声音已开启' : '仅显示字幕。左侧按钮开启声音，右侧按钮改用语音'}
      </div>
    </div>`;
}
