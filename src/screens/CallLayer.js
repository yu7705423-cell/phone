import { html, useState, useEffect, useRef } from '../lib.js';
import { useStore } from '../system/store.js';
import { characters, settings } from '../system/db/index.js';
import { useImage } from '../system/db/useImage.js';
import * as call from '../system/call.js';
import * as accounts from '../system/accounts.js';
import * as camera from '../system/camera.js';
import * as float from '../system/callfloat.js';
import { Avatar, Icon, toast } from '../ui/index.js';

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
          ${l.trans ? html`<span class="call-trans">${l.trans}</span>` : null}
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

// ---- 悬浮球 ----
//
// 缩起来之后通话照常进行，屏幕让给别的页面。球可以拖，松手贴到近的那一边；
// 点一下展开回全屏。上次停在哪儿，这一次打开应用期间记着。
let ballAt = null;
const EDGE = 12;

function CallBall({ s, avatar, scene, name }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const [at, setAt] = useState(ballAt);
  const [dragging, setDragging] = useState(false);

  const box = () => {
    const el = ref.current;
    const parent = el?.offsetParent;
    return el && parent ? { el, w: el.offsetWidth, h: el.offsetHeight, W: parent.clientWidth, H: parent.clientHeight } : null;
  };
  const settle = (x, y) => {
    const b = box();
    if (!b) return;
    const top = (parseFloat(getComputedStyle(b.el).getPropertyValue('--safe-top')) || 0) + EDGE * 3;
    const next = {
      x: x + b.w / 2 < b.W / 2 ? EDGE : b.W - b.w - EDGE,
      y: Math.min(Math.max(y, top), b.H - b.h - EDGE * 6),
    };
    ballAt = next;
    setAt(next);
  };
  // 第一次出现：贴右边、屏幕上方五分之一处
  useEffect(() => {
    if (at) return;
    const b = box();
    if (b) settle(b.W, Math.round(b.H * 0.2));
  }, []);

  const down = e => {
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: at?.x || 0, y0: at?.y || 0, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
  };
  const move = e => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    if (!d.moved) { d.moved = true; setDragging(true); }
    setAt({ x: d.x0 + dx, y: d.y0 + dy });
  };
  const up = e => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    setDragging(false);
    if (!d.moved) { call.expand(); return; }
    settle(d.x0 + (e.clientX - d.sx), d.y0 + (e.clientY - d.sy));
  };

  const video = s.video && !!(scene || avatar);
  const talking = !!s.draft || s.thinking;
  const cls = `call-ball${video ? ' is-video' : ''}${talking ? ' is-talking' : ''}`
    + `${dragging ? ' is-dragging' : ''}${at ? '' : ' is-placing'}`;
  return html`
    <button ref=${ref} class=${cls} aria-label=${`展开通话：${name || ''}`}
      style=${at ? `--ball-x:${Math.round(at.x)}px;--ball-y:${Math.round(at.y)}px` : ''}
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${up}
      onPointerCancel=${() => { drag.current = null; setDragging(false); }}
      onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') call.expand(); }}>
      ${video
        ? html`<span class="call-ball-scene" style=${`background-image:url(${scene || avatar})`}></span>`
        : html`<span class="call-ball-face"><${Avatar} src=${avatar} name=${name} size=${56} radius=${28}/></span>`}
      <span class="call-ball-time">${float.statusOf(s)}</span>
    </button>`;
}

// 桌面悬浮窗那个按钮按下去之后说什么
function deskTap() {
  const k = float.kind();
  if (k === 'native') {
    const r = float.toggleNative();
    if (r === 'asked') toast('请在系统设置中允许 Eira 显示在其他应用上层，返回后再点一次', 'plain', 6000);
    else if (r === 'on') toast('桌面悬浮窗已开启。离开 Eira 时，通话以小窗显示在桌面上', 'ok', 4000);
    else toast('桌面悬浮窗已关闭', 'ok', 2500);
    return;
  }
  if (k === 'pip' || k === 'ios') {
    (k === 'ios' ? float.toggleShell() : float.togglePip())
      .then(() => { if (float.desk.get().pip) call.shrink(); })
      .catch(err => toast(`无法打开悬浮窗：${err.message || err}`, 'error', 5000));
  }
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
  const desk = useStore(float.desk);
  useStore(settings.store);
  // 桌面悬浮窗要的那几样随时备好（画中画必须在点击那一刻同步进去，见 system/callfloat.js）
  useEffect(() => {
    if (!live) return;
    float.prepare({ name: char?.name || '', image: s.video ? (scene || avatar || '') : (avatar || ''), video: s.video });
  }, [live, char?.name, avatar, scene, s.video]);
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

  const deskKind = float.kind();
  const deskOn = deskKind === 'native' ? float.nativeOn() : desk.pip;
  const canShrink = s.phase === 'dialing' || s.phase === 'active';
  const mini = s.mini && canShrink;

  // 缩起来时整层还留着，只是看不见、点不到：摄像头取帧靠的是这一层里的小窗
  // （camera.attach），拆掉的话角色在缩小期间就看不见你了；打了一半的字也还在
  return html`
    ${mini && !desk.pip ? html`<${CallBall} s=${s} avatar=${avatar} scene=${scene} name=${char?.name}/>` : null}
    <div class=${`call-layer${dark ? ' is-video' : ''}${mini ? ' is-mini' : ''}`}
      inert=${mini} aria-hidden=${mini ? 'true' : null}>
      ${canShrink ? html`
        <div class="call-tools">
          <button class="call-tool press" onClick=${call.shrink} aria-label="缩小为悬浮球">
            <${Icon} name="minimize" size=${20}/></button>
          ${deskKind ? html`
            <button class=${`call-tool press${deskOn ? ' is-on' : ''}`} onClick=${deskTap}
              aria-label=${deskOn ? '关闭桌面悬浮窗' : '桌面悬浮窗'}>
              <${Icon} name="pip" size=${20}/></button>` : null}
        </div>` : null}
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
