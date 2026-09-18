import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, Field, Input, Button, toast } from '../../ui/index.js';

const { db, nav, ai } = phone;
const svc = ai.services;

// 会联网搜索的那套接口。
//
// 和聊天预设是同一种形状，区别只在模型本身能不能上网。单独放一份是因为
// 它的用处很窄：目前只有「按地区搜真实存在的吃处」用得上。
// 没配也能用，只是那一档退回按常见食物生成，写不出店名。
export function SearchApiPage() {
  useStore(db.settings.store);
  const v = svc.searchConfig();
  const set = patch => svc.setSearch(patch);

  return html`
    <${Page} title="联网搜索" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="接口地址" desc="OpenAI 兼容的 chat/completions 端点。留空则使用 https://api.openai.com/v1。中转站填写至 /v1 为止。">
          <${Input} value=${v.baseUrl} onInput=${x => set({ baseUrl: x })}
            placeholder="https://api.openai.com/v1"/>
        <//>

        <${Field} label="API Key" desc="仅保存在本设备的浏览器中。">
          <${Input} type="password" value=${v.apiKey} onInput=${x => set({ apiKey: x })}
            placeholder="sk-..."/>
        <//>

        <${Field} label="模型"
          desc="须为自身具备联网搜索能力的模型。普通模型只会凭印象作答，写出来的店名可能并不存在。">
          <${Input} value=${v.model} onInput=${x => set({ model: x })} placeholder="模型名称"/>
        <//>

        <${Button} full variant="ghost"
          onClick=${() => { set({ apiKey: '', model: '', baseUrl: '' }); toast('已清空'); }}>
          清空配置<//>
      </div>

      <div class="settings-foot">
        配置后，「日常 - 吃什么」的批量生成中会出现「联网搜索真实的店」一档，
        生成的条目带有店名，角色的上下文里也会带上。
        该档走这套接口，费用与聊天接口分开计算。未配置时按常见食物生成，不带店名。
      </div>
    <//>`;
}
