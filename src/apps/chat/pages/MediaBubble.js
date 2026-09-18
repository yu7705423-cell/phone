import { html, useState, useRef, useEffect } from '../../../lib.js';
import { phone, useThumb, useFile } from '../../../sdk/index.js';
import { Icon, Spinner, toast } from '../../../ui/index.js';

const { db } = phone;

// 图片消息。角色发的是模型按描述生成的，用户发的是从相册选的 —— 后者已经在
// 本地了，要等的是「识图」把它读成文字，角色才看得见。
function ImageBubble({ msg }) {
  // 气泡最宽 200 逻辑像素，用缩略图。原图留给识图与保存
  const url = useThumb(msg.imageId);
  const mine = msg.role === 'user';

  if (!mine && msg.media === 'pending') {
    return html`
      <div class="bubble media-pending">
        <${Spinner} size=${16}/><span>正在生成图片</span>
      </div>`;
  }
  if (!mine && (msg.media === 'error' || msg.media === 'off')) {
    return html`
      <div class="bubble media-failed">
        <div class="media-prompt">[图片] ${msg.prompt}</div>
        <div class="media-note">${msg.mediaError || '生成失败'}</div>
      </div>`;
  }
  if (!url) return html`<div class="bubble media-pending"><${Spinner} size=${16}/></div>`;

  // chat 档不用提示：图片会跟着当前这一轮的请求直接发给聊天模型
  const note = !mine ? ''
    : msg.vision === 'pending' ? '正在识别'
    : msg.vision === 'off' ? '识图未开启，角色看不到这张图'
    : msg.vision === 'error' ? `识图失败：${msg.visionError || '未知原因'}`
    : '';

  return html`
    <div class="media-wrap">
      <div class="bubble-image">
        <img src=${url} alt=${msg.imageDesc || msg.prompt || ''} loading="lazy"/>
      </div>
      ${note ? html`<div class="media-note">${note}</div>` : null}
    </div>`;
}

// 语音消息。角色发的是合成出来的，用户发的是录的 —— 后者要等识别出文字。
function VoiceBubble({ msg, char }) {
  const url = useFile(msg.audioId);
  const [playing, setPlaying] = useState(false);
  const [showText, setShowText] = useState(false);
  const audioRef = useRef(null);
  const mine = msg.role === 'user';

  useEffect(() => () => { if (audioRef.current) audioRef.current.pause(); }, []);

  if (!mine && msg.media === 'pending') {
    return html`
      <div class="bubble media-pending"><${Spinner} size=${16}/><span>正在合成语音</span></div>`;
  }
  if (!mine && (msg.media === 'error' || msg.media === 'off')) {
    return html`
      <div class="bubble media-failed">
        <div class="media-prompt">[语音] ${msg.voiceText}</div>
        <div class="media-note">${msg.mediaError || '合成失败'}</div>
      </div>`;
  }

  const toggle = () => {
    if (!url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play().catch(() => {}); setPlaying(true); }
  };

  const save = async () => {
    try {
      await phone.downloadFile(msg.audioId, `${char?.name || '语音'}-${msg.id}.mp3`);
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  // 自己录的知道真实时长；角色那边是合成的，按字数估一个
  const seconds = msg.seconds || Math.max(1, Math.round((msg.voiceText || '').length / 4));
  const note = !mine ? ''
    : msg.asr === 'pending' ? '正在识别'
    : msg.asr === 'error' ? `识别失败：${msg.mediaError || '未知原因'}`
    : '';

  return html`
    <div class="voice-wrap">
      <button class="bubble bubble-voice press" onClick=${toggle}>
        <${Icon} name=${playing ? 'close' : 'headphone'} size=${16}/>
        <span class="voice-bars">${[...Array(4)].map((_, i) => html`
          <i key=${i} class=${playing ? 'is-on' : ''} style=${`height:${6 + (i % 3) * 4}px`}></i>`)}</span>
        <span class="voice-len">${seconds}"</span>
      </button>
      <div class="voice-acts">
        <button class="press" onClick=${() => setShowText(!showText)} aria-label="文字">
          <${Icon} name="notes" size=${14}/></button>
        <button class="press" onClick=${save} aria-label="保存到本地">
          <${Icon} name="download" size=${14}/></button>
      </div>
      ${note ? html`<div class="media-note">${note}</div>` : null}
      ${showText ? html`
        <div class="voice-text">
          ${msg.voiceText || '（没有文字）'}
          ${msg.tone ? html`<div class="voice-tone">听起来${msg.tone}</div>` : null}
        </div>` : null}
    </div>`;
}

export function MediaBubble({ msg, char }) {
  return msg.kind === 'image'
    ? html`<${ImageBubble} msg=${msg}/>`
    : html`<${VoiceBubble} msg=${msg} char=${char}/>`;
}
