import { html, useState, useRef, useEffect } from '../../../lib.js';
import { phone, useImage, useFile } from '../../../sdk/index.js';
import { Icon, Spinner, toast } from '../../../ui/index.js';

const { db } = phone;

// 图片消息
function ImageBubble({ msg, onDelete }) {
  const url = useImage(msg.imageId);
  if (msg.media === 'pending') {
    return html`
      <div class="bubble media-pending">
        <${Spinner} size=${16}/><span>正在生成图片</span>
      </div>`;
  }
  if (msg.media === 'error' || msg.media === 'off') {
    return html`
      <div class="bubble media-failed" onDblClick=${() => onDelete(msg)}>
        <div class="media-prompt">[图片] ${msg.prompt}</div>
        <div class="media-note">${msg.mediaError || '没生成出来'}</div>
      </div>`;
  }
  if (!url) return html`<div class="bubble media-pending"><${Spinner} size=${16}/></div>`;
  return html`
    <div class="bubble-image" onDblClick=${() => onDelete(msg)}>
      <img src=${url} alt=${msg.prompt || ''} loading="lazy"/>
    </div>`;
}

// 语音消息。可以播，也可以单独存到本地。
function VoiceBubble({ msg, char, onDelete }) {
  const url = useFile(msg.audioId);
  const [playing, setPlaying] = useState(false);
  const [showText, setShowText] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => () => { if (audioRef.current) audioRef.current.pause(); }, []);

  if (msg.media === 'pending') {
    return html`
      <div class="bubble media-pending"><${Spinner} size=${16}/><span>正在合成语音</span></div>`;
  }
  if (msg.media === 'error' || msg.media === 'off') {
    return html`
      <div class="bubble media-failed" onDblClick=${() => onDelete(msg)}>
        <div class="media-prompt">[语音] ${msg.voiceText}</div>
        <div class="media-note">${msg.mediaError || '没合成出来'}</div>
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

  const seconds = Math.max(1, Math.round((msg.voiceText || '').length / 4));

  return html`
    <div class="voice-wrap">
      <button class="bubble bubble-voice press" onClick=${toggle} onDblClick=${() => onDelete(msg)}>
        <${Icon} name=${playing ? 'close' : 'headphone'} size=${16}/>
        <span class="voice-bars">${[...Array(4)].map((_, i) => html`
          <i key=${i} class=${playing ? 'is-on' : ''} style=${`height:${6 + (i % 3) * 4}px`}></i>`)}</span>
        <span class="voice-len">${seconds}"</span>
      </button>
      <div class="voice-acts">
        <button class="press" onClick=${() => setShowText(!showText)} aria-label="文字">
          <${Icon} name="notes" size=${14}/></button>
        <button class="press" onClick=${save} aria-label="存到本地">
          <${Icon} name="download" size=${14}/></button>
      </div>
      ${showText ? html`<div class="voice-text">${msg.voiceText}</div>` : null}
    </div>`;
}

export function MediaBubble({ msg, char, onDelete }) {
  return msg.kind === 'image'
    ? html`<${ImageBubble} msg=${msg} onDelete=${onDelete}/>`
    : html`<${VoiceBubble} msg=${msg} char=${char} onDelete=${onDelete}/>`;
}
