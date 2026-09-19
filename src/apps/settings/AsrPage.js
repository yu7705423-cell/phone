import { html, useState, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Segmented, toast } from '../../ui/index.js';
import { ApiSource } from './ApiSource.js';

const { db, nav, ai } = phone;
const svc = ai.services;

const MODES = [
  { value: 'text', label: '仅转写文字' },
  { value: 'tone', label: '同时识别语气' },
];

export function AsrPage() {
  useStore(db.settings.store);
  const [rec, setRec] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const handle = useRef(null);

  const a = svc.asrConfig();
  const set = patch => svc.setAsr(patch);
  const tone = a.mode === 'tone';

  const start = async () => {
    try {
      handle.current = await phone.audio.record();
      setRec(Date.now());
    } catch (err) {
      toast('无法录音：' + (err.message || err), 'error', 5000);
    }
  };

  const stop = async () => {
    const h = handle.current;
    handle.current = null;
    setRec(null);
    if (!h) return;
    setBusy(true);
    setResult(null);
    try {
      const { blob } = await h.stop();
      const r = await ai.asr.listen({ blob, key: `asr-test:${Date.now()}` });
      setResult(r);
      toast('识别成功', 'ok');
    } catch (err) {
      toast(String(err.message || err), 'error', 6000);
    } finally { setBusy(false); }
  };

  return html`
    <${Page} title="语音识别" onBack=${nav.pop}>
      <div class="settings-foot">
        用于识别你发出的语音。角色说话用的是「语音合成」，两者是不同的接口。
        未配置时改用浏览器自带的识别：边说边转，不消耗接口额度，
        但只有文字、没有语气，识别质量取决于系统。
        ${phone.audio.speechSupported() ? '' : '这个浏览器不支持本机识别，必须配置接口才能发送语音。'}
      </div>

      <${ApiSource} cfg=${a} set=${set}/>

      <div class="pad">
        <${Field} label="识别方式"
          desc=${tone
            ? '除文字外，同时给出语调、情绪、语速与其他可听出的特征，一并写入上下文。要求模型本身能接收音频，普通的转写端点不支持。'
            : '只把语音转成文字。覆盖面最广，绝大多数中转站都支持。'}>
          <${Segmented} value=${a.mode || 'text'} items=${MODES}
            onChange=${m => { set({ mode: m }); setResult(null); }}/>
        <//>

        ${a.endpointId ? null : html`
<${Field} label="接口地址"
          desc=${tone
            ? '使用 chat/completions 端点。留空则使用 https://api.openai.com/v1。中转站填写至 /v1 为止。'
            : '使用 audio/transcriptions 端点。留空则使用 https://api.openai.com/v1。中转站填写至 /v1 为止。'}>
          <${Input} value=${a.baseUrl} onInput=${x => set({ baseUrl: x })}
            placeholder="https://api.openai.com/v1"/>
        <//>

        <${Field} label="API Key" desc="仅保存在本设备的浏览器中。">
          <${Input} type="password" value=${a.apiKey} onInput=${x => set({ apiKey: x })}
            placeholder="sk-..."/>
        <//>
        `}
        <${Field} label="模型"
          desc=${tone
            ? '须为能直接接收音频的多模态模型，例如 gpt-4o-audio-preview 或中转站提供的同类模型。填写普通转写模型会报错。'
            : '转写模型，例如 whisper-1、gpt-4o-transcribe 或中转站提供的同类模型。'}>
          <${Input} value=${a.model} onInput=${x => set({ model: x })} placeholder="模型名称"/>
        <//>
      </div>

      <${List} title="测试">
        <${ListItem} title=${rec ? '正在录音，点击结束并识别' : '录制一段进行测试'} multiline
          subtitle=${busy ? '识别中' : '录音不会保存，仅用于验证接口'}
          arrow onClick=${() => { if (busy) return; rec ? stop() : start(); }}/>
      <//>

      ${result ? html`
        <div class="pad">
          <div class="fix-preview">${result.text || '（没有识别出文字）'}</div>
          ${result.tone ? html`
            <div class="fix-preview">听出来的语气：${result.tone}</div>` : null}
          ${tone && !result.tone ? html`
            <div class="settings-foot">
              本次没有返回语气信息。可能是该模型并不支持接收音频，仅将请求作为普通文本处理。
            </div>` : null}
        </div>` : null}

      <div class="pad">
        <${Button} full variant="ghost"
          onClick=${() => { set({ apiKey: '', model: '', baseUrl: '' }); setResult(null); toast('已清空'); }}>
          清空配置<//>
      </div>
    <//>`;
}
