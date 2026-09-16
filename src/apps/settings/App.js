import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon } from '../../ui/index.js';
import { ApiPage } from './ApiPage.js';
import { AppearancePage } from './AppearancePage.js';
import { ContextPage } from './ContextPage.js';
import { TemplatesPage } from './TemplatesPage.js';
import { StoragePage } from './StoragePage.js';

const { db, nav } = phone;

function Home() {
  const s = useStore(db.settings.store);
  const configured = phone.ai.isConfigured();

  return html`
    <${Page} title="设置">
      <${List} title="模型">
        <${ListItem} title="接口与密钥"
          subtitle=${configured ? `${s.provider} · ${s.model}` : '未配置，聊天不可用'} arrow
          left=${html`<${Icon} name="key" size=${18}/>`}
          onClick=${() => nav.push('/api')}/>
        <${ListItem} title="上下文与记忆" subtitle="注入顺序、历史轮次、自动总结" arrow
          left=${html`<${Icon} name="layers" size=${18}/>`}
          onClick=${() => nav.push('/context')}/>
        <${ListItem} title="Prompt 模板" subtitle="骨架与各任务的提示词" arrow
          left=${html`<${Icon} name="sparkle" size=${18}/>`}
          onClick=${() => nav.push('/templates')}/>
      <//>

      <${List} title="外观">
        <${ListItem} title="主题、壁纸与图标"
          subtitle="深色模式、状态栏、主界面与锁屏壁纸、各 app 的图标和底色" arrow multiline
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
        小手机 · 本地运行，数据只存在这台设备上
      </div>
    <//>`;
}

export default function SettingsApp({ route }) {
  if (route === '/api') return html`<${ApiPage}/>`;
  if (route === '/appearance') return html`<${AppearancePage}/>`;
  if (route === '/context') return html`<${ContextPage}/>`;
  if (route === '/templates') return html`<${TemplatesPage}/>`;
  if (route === '/storage') return html`<${StoragePage}/>`;
  return html`<${Home}/>`;
}
