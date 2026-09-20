import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Segmented, Button, Avatar,
         EmptyState, toast } from '../../../ui/index.js';

const { db, nav, trip, accounts } = phone;

// 新建一次出行。
//
// **必须挑一段会话。** 一次出行是「和谁一起去」，没有对方就不成立 ——
// 这和情侣空间一样，关系长在会话上。单人出行这个 app 不做：
// 那是日程的事，不是这儿的事。
//
// 建完**往那段会话里落一条提议**，角色下一轮就看见了。不落的话它要到
// 下次注入才隐约知道有这回事，而那时你已经在问它想去哪儿了。

export function NewPage() {
  useStore(db.chats.store);
  useStore(db.characters.store);

  const [kind, setKind] = useState(trip.TRIP);
  const [chatId, setChatId] = useState('');
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [when, setWhen] = useState('');

  // 单人会话才算一段关系。群聊里没有「我们俩」这回事
  const pairs = db.chats.all()
    .filter(c => (c.characterIds || []).length === 1)
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
    .map(c => ({ chat: c, char: db.characters.get(c.characterIds[0]) }))
    .filter(x => !!x.char);

  if (!pairs.length) {
    return html`<${Page} title="新建出行" onBack=${nav.pop}>
      <${EmptyState} icon="compass" title="还没有可以同行的人"
        desc="出行需要一段单人对话。先在「聊天」中与一个角色开始对话。"/>
    <//>`;
  }

  const k = trip.kindOf(kind);

  const save = () => {
    const pick = pairs.find(p => p.chat.id === chatId) || pairs[0];
    try {
      const row = trip.create({
        chatId: pick.chat.id, kind,
        title: title.trim() || place.trim(),
        place: place.trim(),
        proposedBy: 'me',
      });
      // 往那段会话里落一条提议。角色下一轮看见，写 [同行] 或 [不去]
      const me = accounts.get(pick.chat.personaId) || accounts.current();
      trip.propose({
        chatId: pick.chat.id, role: 'user', authorId: me?.id || 'me',
        where: place.trim() || title.trim(), when: when.trim(),
        extra: { tripId: row.id },
      });
      toast('已新建，并在对话中提出', 'ok', 4000);
      nav.replace(`/trip/${row.id}`);
    } catch (e) {
      toast(String(e.message || e), 'error', 4000);
    }
  };

  const ready = !!(title.trim() || place.trim());

  return html`
    <${Page} title="新建出行" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <${Field} label="类型">
          <${Segmented} value=${kind} onChange=${setKind}
            items=${trip.KINDS.map(x => ({ value: x.id, label: x.label }))}/>
        <//>
      </div>

      <${List} title="同行的人">
        ${pairs.map(p => html`
          <${ListItem} key=${p.chat.id} title=${p.char.name}
            left=${html`<${Avatar} name=${p.char.name} size=${32}/>`}
            right=${html`<span class="tag">${
              (chatId || pairs[0].chat.id) === p.chat.id ? '已选' : ''}</span>`}
            onClick=${() => setChatId(p.chat.id)}/>`)}
      <//>

      <div class="pad-x pad-t">
        <${Field} label=${k.what} desc="地点，或场馆所在的城市。">
          <${Input} value=${place} onInput=${setPlace}/>
        <//>
        <${Field} label="名称" desc="留空时使用上面填写的地点。">
          <${Input} value=${title} onInput=${setTitle}/>
        <//>
        <${Field} label="时间"
          desc="向对方提出的时间，可以不精确。确切的出发日期在详情页中填写。">
          <${Input} value=${when} onInput=${setWhen}/>
        <//>
      </div>

      <div class="pad">
        <${Button} full disabled=${!ready} onClick=${save}>新建<//>
      </div>
      <div class="settings-foot">
        新建后会在该段对话中发出一条出行提议，由对方回应。不调用接口。
      </div>
    <//>`;
}
