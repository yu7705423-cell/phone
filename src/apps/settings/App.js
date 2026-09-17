import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, toast } from '../../ui/index.js';
import { ApiPage } from './ApiPage.js';
import { VoicePage } from './VoicePage.js';
import { ImagePage } from './ImagePage.js';
import { AppearancePage } from './AppearancePage.js';
import { StoragePage } from './StoragePage.js';
import { NotifyPage } from './NotifyPage.js';
import { EmbedPage } from './EmbedPage.js';
import { BUILD } from '../../version.js';
import { forceUpdate } from './forceUpdate.js';

const { db, nav } = phone;

function Home() {
  const s = useStore(db.settings.store);
  const svc = phone.ai.services;
  const chat = svc.services().chat;
  const active = svc.activeChat();
  const spare = svc.fallbackChat();
  const chatDesc = active
    ? `${active.name} · ${active.model || '未选模型'}${spare ? `，副用 ${spare.name}` : ''}`
    : '未配置，聊天不可用';
  const voice = svc.voiceConfig();
  const voiceDesc = voice.enabled && voice.apiKey ? `已配置 · ${voice.model || '未选模型'}` : '未配置';
  const imgActive = svc.activeImage();
  const imageDesc = imgActive ? `${imgActive.name} · ${imgActive.model || '未选模型'}` : '未配置';

  const emb = svc.embedConfig();
  const embDone = phone.ai.memvec.indexedCount();
  const embDesc = emb.apiKey && emb.model
    ? `${emb.model} · 已索引 ${embDone} / ${db.memories.count()} 条记忆`
    : '未配置。配了之后记忆按意思检索，不再硬碰关键词';

  const nc = phone.sound.config();
  const soundName = nc.soundFileId ? '自己传的'
    : (phone.sound.PRESETS.find(p => p.id === nc.sound) || {}).label || '清脆';
  const notifyDesc = `${nc.banner ? '横幅开着' : '横幅关着'} · 提示音 ${soundName}`;

  const update = async () => {
    toast('正在获取最新代码', 'plain');
    const r = await forceUpdate();
    toast(r.fail ? `${r.total} 个文件中有 ${r.fail} 个获取失败，仍将尝试重新加载` : `${r.ok} 个文件已更新，正在重新加载`,
      r.fail ? 'plain' : 'ok');
    setTimeout(() => location.reload(), 900);
  };

  return html`
    <${Page} title="设置">
      <${List} title="服务">
        <${ListItem} title="接口" subtitle=${chatDesc} arrow
          left=${html`<${Icon} name="key" size=${19}/>`}
          onClick=${() => nav.push('/api')}/>
        <${ListItem} title="语音" subtitle=${voiceDesc} arrow
          left=${html`<${Icon} name="headphone" size=${19}/>`}
          onClick=${() => nav.push('/voice')}/>
        <${ListItem} title="生图" subtitle=${imageDesc} arrow
          left=${html`<${Icon} name="camera" size=${19}/>`}
          onClick=${() => nav.push('/image')}/>
        <${ListItem} title="向量" subtitle=${embDesc} arrow multiline
          left=${html`<${Icon} name="brain" size=${19}/>`}
          onClick=${() => nav.push('/embed')}/>
      <//>

      <${List} title="外观">
        <${ListItem} title="通知" subtitle=${notifyDesc} arrow multiline
          left=${html`<${Icon} name="bell" size=${18}/>`}
          onClick=${() => nav.push('/notify')}/>
        <${ListItem} title="主题"
          subtitle="深色模式、壁纸、图标颜色与阴影、自定义 CSS" arrow multiline
          left=${html`<${Icon} name="grid" size=${18}/>`}
          onClick=${() => nav.push('/appearance')}/>
      <//>

      <${List} title="数据">
        <${ListItem} title="存储与备份" subtitle="占用统计、导入导出、清空数据" arrow
          left=${html`<${Icon} name="database" size=${18}/>`}
          onClick=${() => nav.push('/storage')}/>
        <${ListItem} title="强制更新" multiline arrow
          subtitle=${`当前版本 ${BUILD}。若界面仍为旧版，点击此处清除缓存的旧代码并重新加载。`}
          left=${html`<${Icon} name="refresh" size=${18}/>`} onClick=${update}/>
      <//>

      <div class="settings-foot">
        我的人设在「聊天」里的「主页」中编辑<br/>
        上下文、记忆与 Prompt 模板在会话右上角的菜单里<br/>
        小手机 · 本地运行，数据只存在这台设备上<br/>
        构建 ${BUILD}
      </div>
    <//>`;
}

export default function SettingsApp({ route }) {
  if (route === '/api') return html`<${ApiPage}/>`;
  if (route === '/notify') return html`<${NotifyPage}/>`;
  if (route === '/embed') return html`<${EmbedPage}/>`;
  if (route === '/voice') return html`<${VoicePage}/>`;
  if (route === '/image') return html`<${ImagePage}/>`;
  if (route === "/appearance") return html`<${AppearancePage}/>`;
  if (route === '/storage') return html`<${StoragePage}/>`;
  return html`<${Home}/>`;
}
