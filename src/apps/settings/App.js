import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Switch, Segmented, Button, Icon, Field, toast, confirm, prompt } from '../../ui/index.js';
import { ApiPage } from './ApiPage.js';
import { PersonaPage } from './PersonaPage.js';
import { ContextPage } from './ContextPage.js';
import { TemplatesPage } from './TemplatesPage.js';
import { StoragePage } from './StoragePage.js';

const { db, nav } = phone;

function Home() {
  const s = useStore(db.settings.store);
  const me = useStore(db.persona.store);
  const configured = phone.ai.isConfigured();

  return html`
    <${Page} title="设置">
      <${List} title="账户">
        <${ListItem} title="我的人设" subtitle=${me.name || '未设置'} arrow
          left=${html`<${Icon} name="user" size=${18}/>`}
          onClick=${() => nav.push('/persona')}/>
      <//>

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
        <${ListItem} title="深色模式"
          left=${html`<${Icon} name=${s.theme === 'dark' ? 'moon' : 'sun'} size=${18}/>`}
          right=${html`<${Switch} checked=${s.theme === 'dark'}
            onChange=${v => db.settings.set({ theme: v ? 'dark' : 'light' })}/>`}/>
        <${ListItem} title="模拟状态栏" multiline
          subtitle="手机浏览器本身已有状态栏，再显示一条会是双份。自动模式在触摸设备上隐藏。"
          right=${html`<div style="width:150px"><${Segmented}
            value=${s.statusBar}
            onChange=${v => db.settings.set({ statusBar: v })}
            items=${[{ value: 'auto', label: '自动' }, { value: 'on', label: '显示' }, { value: 'off', label: '隐藏' }]}/></div>`}/>
        <${ListItem} title="启动时显示锁屏"
          left=${html`<${Icon} name="lock" size=${18}/>`}
          right=${html`<${Switch} checked=${s.showLockScreen}
            onChange=${v => db.settings.set({ showLockScreen: v })}/>`}/>
      <//>

      <${List} title="数据">
        <${ListItem} title="存储与备份" subtitle="占用统计、导入导出、清空" arrow
          left=${html`<${Icon} name="database" size=${18}/>`}
          onClick=${() => nav.push('/storage')}/>
      <//>

      <div class="settings-foot">小手机 · 本地运行，数据只存在这台设备上</div>
    <//>`;
}

export default function SettingsApp({ route }) {
  if (route === '/api') return html`<${ApiPage}/>`;
  if (route === '/persona') return html`<${PersonaPage}/>`;
  if (route === '/context') return html`<${ContextPage}/>`;
  if (route === '/templates') return html`<${TemplatesPage}/>`;
  if (route === '/storage') return html`<${StoragePage}/>`;
  return html`<${Home}/>`;
}
