import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Switch, Segmented, Button,
         Icon, toast } from '../../../ui/index.js';
import { ZonePicker } from './ZonePicker.js';

const { db, nav, clock } = phone;

const MODES = [
  { value: 'real', label: '跟真实时间' },
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

  const useNow = () => { setVirtual(Date.now()); toast('对上现在这一刻了'); };

  // 时区不一样的角色列出来，省得为了确认一眼要翻遍所有角色卡
  // 按实际时差比，不按 id 比 —— 我选「本地」、她填「中国·上海」，那是同一个地方
  const away = db.characters.all().filter(c => c.timezone && clock.zoneDiff(c.timezone, uz, now) !== 0);

  return html`
    <${Page} title="时间感知" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="时间感知" multiline
          subtitle="告诉角色现在几点、你们差几个时区、上次聊天隔了多久。关掉就一个字都不提"
          right=${html`<${Switch} checked=${on}
            onChange=${v => db.settings.set({ injectTime: v })}/>`}/>
      <//>

      ${on ? html`
        <${List}>
          <${ListItem} title="让她自己写出时间" multiline
            subtitle="每条回复先写一行当地时间，显示的时候过滤掉。光在设定里写「现在三点」模型常常视而不见，自己写过一遍才算真看见"
            right=${html`<${Switch} checked=${s.timeStamp !== false}
              onChange=${v => db.settings.set({ timeStamp: v })}/>`}/>
        <//>

        <div class="pad">
          <${Field} label="时间从哪儿来"
            desc=${virtual
              ? '自定义之后，时间会从你设的那一刻接着往下走，不是钉死在一个点上'
              : '用这台设备的真实时间'}>
            <${Segmented} value=${s.timeMode || 'real'} items=${MODES}
              onChange=${v => {
                if (v === 'virtual' && !s.timeVirtualAt) setVirtual(Date.now());
                db.settings.set({ timeMode: v });
              }}/>
          <//>

          ${virtual ? html`
            <${Field} label="从哪一刻开始">
              <input class="dt-input" type="datetime-local"
                value=${toLocalInput(s.timeVirtualAt || Date.now())}
                onInput=${e => {
                  const ms = new Date(e.target.value).getTime();
                  if (!Number.isNaN(ms)) setVirtual(ms);
                }}/>
              <div class="btn-row pad-t">
                <${Button} size="sm" variant="ghost" icon="clock" onClick=${useNow}>对到现在<//>
              </div>
            <//>` : null}
        </div>

        ${virtual ? html`
          <${List}>
            <${ListItem} title="停在这一刻" multiline
              subtitle="开了时间就不再往前走，永远是你设的那个点。适合一场不该天亮的戏"
              right=${html`<${Switch} checked=${!!s.timeFrozen}
                onChange=${v => db.settings.set({ timeFrozen: v })}/>`}/>
          <//>` : null}

        <${List} title="谁在哪儿">
          <${ListItem} title="我在" subtitle=${clock.zoneLabel(uz)} arrow multiline
            left=${html`<${Icon} name="map" size=${18}/>`}
            onClick=${() => setPicking(true)}/>
        <//>
        <div class="settings-foot">
          角色在哪儿写在各自的角色卡里 —— 那是她的事，不是这儿的事。
          没单独设的就当和你同城。
        </div>

        ${away.length ? html`
          <${List} title="跟你不在一个时区的">
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
                ? (s.timeFrozen ? '虚拟时间，停着不走' : '虚拟时间，正在往下走')
                : '真实时间'}
            </div>
          </div>
        </div>`
      : html`<div class="settings-foot">
          关着的时候，角色不知道今天几号、现在几点，也不知道你隔了多久才回。
        </div>`}

      <${ZonePicker} open=${picking} value=${uz} title="我在哪儿"
        onPick=${id => db.settings.set({ timeZoneUser: id })}
        onClose=${() => setPicking(false)}/>
    <//>`;
}
