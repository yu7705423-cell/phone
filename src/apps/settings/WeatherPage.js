import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, Field, Input, Button, toast } from '../../ui/index.js';

const { db, nav, ai } = phone;
const svc = ai.services;

// 和风天气。配好之后，开了当日日程、又在角色卡上填了「所在地区」的角色，
// 排日程时会查那座城市当天的预报，写进日程请求与聊天上下文。
// 查天气不调模型接口；和风那边按它自己的额度计。
export function WeatherPage() {
  useStore(db.settings.store);
  const v = svc.qweatherConfig();
  const [city, setCity] = useState('');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const set = patch => svc.setQweather(patch);

  const test = async () => {
    const name = city.trim() || '北京';
    setBusy(true);
    setOut('');
    try {
      const w = await phone.weather.forecast(name);
      setOut(`${phone.weather.label(w)}（${w.date}）`);
    } catch (err) { setOut(`查询失败：${err.message || err}`); }
    finally { setBusy(false); }
  };

  return html`
    <${Page} title="和风天气" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="API Host"
          desc="在和风天气控制台的「设置」中查看，每个账号一个，形如 abc1234xyz.re.qweatherapi.com。旧的公共域名已逐步停用。">
          <${Input} value=${v.host} onInput=${x => set({ host: x.trim(), cities: {} })}
            placeholder="abc1234xyz.re.qweatherapi.com"/>
        <//>
        <${Field} label="API KEY" desc="在控制台的「项目管理」中创建凭据时选择 API KEY。仅保存在本设备的浏览器中。">
          <${Input} type="password" value=${v.key} onInput=${x => set({ key: x.trim() })} placeholder="API KEY"/>
        <//>
        <${Field} label="测试查询" desc="输入一个城市名，查询今天的预报。留空则查询北京。">
          <${Input} value=${city} onInput=${setCity} placeholder="例如：成都"/>
        <//>
        <${Button} full variant="ghost" onClick=${test} disabled=${busy || !svc.qweatherReady()}>
          ${busy ? '正在查询' : '查询'}<//>
        ${out ? html`<div class=${`settings-foot${/^查询失败/.test(out) ? ' is-error' : ''}`}>${out}</div>` : null}
        <${Button} full variant="ghost"
          onClick=${() => { set({ host: '', key: '', cities: {} }); toast('已清空'); }}>清空配置<//>
      </div>
      <div class="settings-foot">
        配置后，开启了当日日程、并在角色卡上填写了「所在地区」的角色，每天安排日程时会查询该地当天的天气预报，
        写入日程的生成请求，并在当天的对话中一并告知角色。按城市名查询，查到的城市编号会记住，不重复查询。<br/>
        查询天气不调用模型接口，用量计入和风天气账号自身的额度。
      </div>
    <//>`;
}
