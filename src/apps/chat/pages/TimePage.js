import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Switch, Segmented, Button,
         Icon, toast } from '../../../ui/index.js';
import { ZonePicker } from './ZonePicker.js';

const { db, nav, clock } = phone;

const MODES = [
  { value: 'real', label: '系统时间' },
  { value: 'virtual', label: '自定义' },
];

// datetime-local 要的是本地墙上时间，不带时区，所以不能用 toISOString
function toLocalInput(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function TimePage() {
  const s = useStore(db.settings.store);
  useStore(db.characters.store);
  const [picking, setPicking] = useState(false);
  const [, tick] = useState(0);

  // 预览要走字，不然看不出虚拟时间到底在不在动
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const on = s.injectTime !== false;
  const virtual = s.timeMode === 'virtual';
  const now = clock.now();
  const uz = clock.userZone();

  // 设了新时刻就重新对表：记下这一刻的真实时间，往后按差值走
  const setVirtual = ms => db.settings.set({ timeVirtualAt: ms, timeSetAt: Date.now() });

  const useNow = () => { setVirtual(Date.now()); toast('已校准到当前时间'); };

  // 时区不一样的角色列出来，省得为了确认一眼要翻遍所有角色卡
  // 按实际时差比，不按 id 比 —— 我选「本地」、她填「中国·上海」，那是同一个地方
  const away = db.characters.all().filter(c => c.timezone && clock.zoneDiff(c.timezone, uz, now) !== 0);

  return html`
    <${Page} title="时间感知" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="时间感知" multiline
          subtitle="向角色提供当前时间、双方时差与距上次对话的间隔。关闭后不注入任何时间信息"
          right=${html`<${Switch} checked=${on}
            onChange=${v => db.settings.set({ injectTime: v })}/>`}/>
      <//>

      ${on ? html`
        <${List}>
          <${ListItem} title="要求角色写出时间" multiline
            subtitle="角色每条回复先输出一行当地时间，界面上过滤不显示。仅在设定中告知时间，模型往往不会真正参照；要求其输出一次，时间才会进入推理"
            right=${html`<${Switch} checked=${s.timeStamp !== false}
              onChange=${v => db.settings.set({ timeStamp: v })}/>`}/>
        <//>

        <div class="pad">
          <${Field} label="时间来源"
            desc=${virtual
              ? '自设定的时刻起继续推进，而非固定在该时刻'
              : '采用本设备的系统时间'}>
            <${Segmented} value=${s.timeMode || 'real'} items=${MODES}
              onChange=${v => {
                if (v === 'virtual' && !s.timeVirtualAt) setVirtual(Date.now());
                db.settings.set({ timeMode: v });
              }}/>
          <//>

          ${virtual ? html`
            <${Field} label="起始时刻">
              <input class="dt-input" type="datetime-local"
                value=${toLocalInput(s.timeVirtualAt || Date.now())}
                onInput=${e => {
                  const ms = new Date(e.target.value).getTime();
                  if (!Number.isNaN(ms)) setVirtual(ms);
                }}/>
              <div class="btn-row pad-t">
                <${Button} size="sm" variant="ghost" icon="clock" onClick=${useNow}>校准到当前时间<//>
              </div>
            <//>` : null}
        </div>

        ${virtual ? html`
          <${List}>
            <${ListItem} title="固定时刻" multiline
              subtitle="开启后时间不再推进，始终停留在设定的时刻"
              right=${html`<${Switch} checked=${!!s.timeFrozen}
                onChange=${v => db.settings.set({ timeFrozen: v })}/>`}/>
          <//>` : null}

        <${List} title="所在时区">
          <${ListItem} title="本人所在时区" subtitle=${clock.zoneLabel(uz)} arrow multiline
            left=${html`<${Icon} name="map" size=${18}/>`}
            onClick=${() => setPicking(true)}/>
        <//>
        <div class="settings-foot">
          角色所在时区在各自的角色卡中设置。未单独设置的角色，视为与本人处于同一时区。
        </div>

        ${away.length ? html`
          <${List} title="与本人存在时差的角色">
            ${away.map(c => html`
              <${ListItem} key=${c.id} title=${c.name} subtitle=${clock.zoneLabel(c.timezone)}
                right=${html`<span class="zone-now">${clock.clockOnly(now, c.timezone)}</span>`}
                arrow onClick=${() => nav.push(`/edit/${c.id}`)}/>`)}
          <//>` : null}

        <div class="pad">
          <div class="time-preview">
            <div class="time-big">${clock.clockOnly(now, uz)}</div>
            <div class="time-sub">${clock.format(now, uz)} · ${clock.zoneLabel(uz)}</div>
            <div class="time-note">
              ${virtual
                ? (s.timeFrozen ? '自定义时间 · 已固定' : '自定义时间 · 持续推进')
                : '系统时间'}
            </div>
          </div>
        </div>`
      : html`<div class="settings-foot">
          关闭状态下，角色不知道当前日期与时间，也不知道距上次对话过去了多久。
        </div>`}

      <${ZonePicker} open=${picking} value=${uz} title="本人所在时区"
        onPick=${id => db.settings.set({ timeZoneUser: id })}
        onClose=${() => setPicking(false)}/>
    <//>`;
}
