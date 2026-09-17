import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, EmptyState, Button, Icon } from '../../ui/index.js';

const { nav, apps: appsApi } = phone;

// 占位应用。先把主界面摆满，图标和名字都能在主题设置里改。
export function makeStub(appId) {
  return function StubApp() {
    useStore(appsApi.store);
    const app = appsApi.get(appId);
    return html`
      <${Page} title=${app?.name || '占位'}>
        <${EmptyState} icon=${app?.icon || 'grid'}
          title=${`${app?.name || '这个位置'}还没做`}
          desc="这是一个占位应用。名称与图标可在「设置 - 主题」中修改，用于布置主界面。"
          action=${html`<${Button} size="sm" icon="settings"
            onClick=${() => phone.intent.open('settings', { route: '/appearance' })}>去改外观<//>`}/>
      <//>`;
  };
}
