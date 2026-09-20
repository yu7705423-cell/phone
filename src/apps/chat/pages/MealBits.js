import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Sheet, Field, Input, Segmented, Button, Icon, List, ListItem, Switch,
         IconButton, toast } from '../../../ui/index.js';

const { db, takeout, geo, panel, currency } = phone;

// ---- 外卖 ----

const KIND_ITEMS = [
  { value: takeout.SELF, label: '给自己' },
  { value: takeout.TREAT, label: '请对方' },
  { value: takeout.ASK, label: '让对方付' },
];
const KIND_DESC = {
  [takeout.SELF]: '给自己点，自己付。对方只是知道你在吃什么。',
  [takeout.TREAT]: '给对方点，你付。对方可以收下，也可以谢绝。',
  [takeout.ASK]: '给自己点，让对方付。对方可以代付，也可以不付。',
};

export function TakeoutBubble({ msg, onSettle }) {
  const pending = msg.takeout === takeout.PENDING;
  // 自己点的那一单不能自己处理 —— 收不收是对方的事
  const actionable = pending && msg.role !== 'user' && onSettle;
  const foot = takeout.stateLabel(msg.takeoutKind, msg.takeout);
  return html`
    <div class=${`bubble bubble-meal${pending ? '' : ' is-done'}`}
      onClick=${actionable ? () => onSettle(msg) : null}>
      <div class="tr-top">
        <${Icon} name="cup" size=${20}/>
        <div class="tr-body">
          <div class="meal-item ellipsis">${msg.item}</div>
          <div class="meal-price">${takeout.format(msg.amount, msg.currency)}</div>
        </div>
      </div>
      ${foot ? html`
        <div class="tr-foot">${foot}${actionable ? ' · 点击处理' : ''}</div>` : null}
    </div>`;
}

export function TakeoutSheet({ open, chatId, onClose }) {
  const [kind, setKind] = useState(takeout.SELF);
  const [item, setItem] = useState('');
  const [amount, setAmount] = useState('');
  const cur = currency.current();

  const close = () => { setItem(''); setAmount(''); setKind(takeout.SELF); onClose(); };
  const submit = () => {
    try {
      takeout.order({ chatId, role: 'user', authorId: 'me', kind, item, amount });
      close();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${Sheet} open=${open} onClose=${close} title="点外卖">
      <div class="pad">
        <${Field} label="给谁点" desc=${KIND_DESC[kind]}>
          <${Segmented} value=${kind} items=${KIND_ITEMS} onChange=${setKind}/>
        <//>
        <${Field} label="点的什么">
          <${Input} value=${item} onInput=${setItem} placeholder="例如：麻辣烫 加了鹌鹑蛋"/>
        <//>
        <${Field} label=${`金额（${cur.label}）`} desc="可以填 0，表示不计金额。">
          <${Input} type="number" inputmode="decimal" value=${amount}
            onInput=${setAmount} placeholder="0"/>
        <//>
        <${Button} full disabled=${!item.trim()} onClick=${submit}>下单<//>
      </div>
    <//>`;
}

// 对方点来的那一单，收下还是不要
export function MealSettleSheet({ msg, onClose }) {
  if (!msg) return null;
  const char = db.characters.get(msg.authorId);
  const treat = msg.takeoutKind === takeout.TREAT;
  const act = take => { takeout.settle(msg.id, take); onClose(); };
  return html`
    <${Sheet} open=${!!msg} onClose=${onClose}
      title=${`${char?.name || '对方'}${treat ? '点给你' : '让你付'} ${msg.item}`}>
      <div class="settings-foot">${takeout.format(msg.amount, msg.currency)}</div>
      <${List} inset=${false}>
        <${ListItem} title=${treat ? '要了' : '替对方付'} arrow
          left=${html`<${Icon} name="check" size=${18}/>`} onClick=${() => act(true)}/>
        <${ListItem} title=${treat ? '谢绝' : '不付'} arrow
          left=${html`<${Icon} name="close" size=${18}/>`} onClick=${() => act(false)}/>
      <//>
      <div class="settings-foot">处理结果会告知对方。</div>
    <//>`;
}

// ---- 共享位置 ----

function SpotFields({ label, desc, spot, onChange, onLocate }) {
  const s = spot || { place: '', lat: null, lng: null };
  const set = patch => onChange({ ...s, ...patch });
  return html`
    <${Field} label=${label} desc=${desc}>
      <${Input} value=${s.place} onInput=${v => set({ place: v })} placeholder="地点名称"/>
      <div class="num-row pad-t">
        <${Input} type="number" inputmode="decimal" value=${s.lat ?? ''}
          onInput=${v => set({ lat: v })} placeholder="纬度"/>
        <${Input} type="number" inputmode="decimal" value=${s.lng ?? ''}
          onInput=${v => set({ lng: v })} placeholder="经度"/>
      </div>
      <div class="chip-row">
        ${onLocate ? html`
          <button class="chip" onClick=${onLocate}>用当前位置</button>` : null}
        ${geo.CITIES.map(c => html`
          <button key=${c.name} class=${`chip${s.place === c.name ? ' is-active' : ''}`}
            onClick=${() => onChange({ place: c.name, lat: c.lat, lng: c.lng })}>${c.name}</button>`)}
      </div>
    <//>`;
}

export function ShareSheet({ open, chatId, onClose }) {
  useStore(db.chats.store);
  const chat = db.chats.get(chatId);
  const char = chat ? db.characters.get((chat.characterIds || [])[0]) : null;
  const st = geo.stateOf(chat);
  const sum = geo.summary(chatId);

  const useHere = async () => {
    try {
      const at = await geo.locate();
      geo.setSpot(chatId, 'me', { ...(st.me || {}), ...at, place: st.me?.place || '当前位置' });
      toast('已填入当前位置', 'ok');
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
  };

  return html`
    <${Sheet} open=${open} onClose=${onClose} title="共享位置">
      <${List} inset=${false}>
        <${ListItem} title="开启" multiline
          subtitle=${`开启后，双方所在地与算好的直线距离会随对话一并告知角色。`
            + `距离由本地计算，不由模型估算。关闭后角色不知道你们相距多远。`}
          right=${html`<${Switch} checked=${st.on}
            onChange=${v => geo.setOn(chatId, v)}/>`}/>
      <//>

      ${st.on ? html`
        <div class="pad">
          ${sum ? html`
            <div class="hint-box">
              ${sum.text
                ? `当前相距 ${sum.text}。这个数字随坐标变化，角色读到的就是它。`
                : '两端都填了地点，但缺少坐标，因此算不出距离。'}
            </div>` : html`
            <div class="hint-box">两端都填好之后才算得出距离。</div>`}

          <${SpotFields} label="我的位置"
            desc="坐标只存在本机，不上传。点城市可一键填入，也可以手动填写经纬度。"
            spot=${st.me} onLocate=${useHere}
            onChange=${v => geo.setSpot(chatId, 'me', v)}/>

          <${SpotFields} label=${`${char?.name || '角色'}的位置`}
            desc="按角色的设定填。角色自己不会改这一项。"
            spot=${st.char}
            onChange=${v => geo.setSpot(chatId, 'char', v)}/>
        </div>` : null}
    <//>`;
}

// ---- 面板的「更多」----

export function MoreSheet({ open, onClose, onTap }) {
  useStore(db.settings.store);
  const list = panel.order();
  const more = panel.moreSet();

  return html`
    <${Sheet} open=${open} onClose=${onClose} title="更多">
      <div class="settings-foot">
        点击任意一项直接使用。右侧开关决定它出现在面板上还是收在这里，
        箭头调整顺序。面板上放几个没有上限。
      </div>
      <${List} inset=${false}>
        ${list.map((id, i) => {
          const it = panel.itemOf(id);
          return html`
            <${ListItem} key=${id} title=${it.label}
              subtitle=${more.has(id) ? '收在更多里' : '在面板上'}
              left=${html`<${Icon} name=${it.icon} size=${19}/>`}
              right=${html`
                <button class="order-btn press" disabled=${i === 0}
                  onClick=${e => { e.stopPropagation(); panel.move(id, -1); }} aria-label="上移">
                  <${Icon} name="chevronUp" size=${15}/></button>
                <button class="order-btn press" disabled=${i === list.length - 1}
                  onClick=${e => { e.stopPropagation(); panel.move(id, 1); }} aria-label="下移">
                  <${Icon} name="chevronDown" size=${15}/></button>
                <${Switch} checked=${!more.has(id)}
                  onChange=${v => panel.setMore(id, !v)}/>`}
              onClick=${() => { onClose(); onTap(id); }}/>`;
        })}
      <//>
      <div class="pad">
        <${Button} full variant="ghost" onClick=${() => panel.reset()}>恢复默认<//>
      </div>
    <//>`;
}
