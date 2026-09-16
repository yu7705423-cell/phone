import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon } from '../../ui/index.js';
import { ApiPage } from './ApiPage.js';
import { VoicePage } from './VoicePage.js';
import { ImagePage } from './ImagePage.js';
import { AppearancePage } from './AppearancePage.js';
import { StoragePage } from './StoragePage.js';
import { BUILD } from '../../version.js';

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
      <//>

      <${List} title="外观">
        <${ListItem} title="主题"
          subtitle="深色模式、壁纸、图标颜色与阴影、自定义 CSS" arrow multiline
          left=${html`<${Icon} name="grid" size=${18}/>`}
          onClick=${() => nav.push('/appearance')}/>
      <//>

      <${List} title="数据">
        <${ListItem} title="存储与备份" subtitle="占用统计、导入导出、清空" arrow
          left=${html`<${Icon} name="database" size=${18}/>`}
          onClick=${() => nav.push('/storage')}/>
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
  if (route === '/voice') return html`<${VoicePage}/>`;
  if (route === '/image') return html`<${ImagePage}/>`;
  if (route === "/appearance") return html`<${AppearancePage}/>`;
  if (route === '/storage') return html`<${StoragePage}/>`;
  return html`<${Home}/>`;
}
