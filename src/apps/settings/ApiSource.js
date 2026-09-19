import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { List, ListItem, Field, Input, Button, Sheet, Icon, toast, confirm } from '../../ui/index.js';

const { db, ai } = phone;
const svc = ai.services;

// 「接口来源」。向量、重排、识图、语音识别、记忆、翻译、联网搜索这七套，
// 形状都是「地址 + 密钥 + 模型」，而多数人这七套走的是同一个中转站。
// 所以地址与密钥可以从别处取，各页面只管自己那个模型名。
//
// 来源有两种：**已有的聊天预设**（多数人本来就配好了），
// 和**自己建的一条**（存下来，七个页面都能选）。两种共用一个 id 空间。
//
// 选了来源之后地址与密钥是**引用**不是拷贝：改一次来源，用它的服务全都跟着变。
// 这正是七个页面各填一遍解决不了的那件事。
//
// 七个页面共用这一个组件，不要各写一份。

export function ApiSource({ cfg, set, label = '接口来源' }) {
  useStore(db.settings.store);
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState(null);   // 正在新建的那条

  const own = svc.endpoints();
  const chat = svc.chatPresets().filter(p => p.baseUrl || p.apiKey);
  const src = svc.sourceOf(cfg.endpointId);

  const use = id => { set({ endpointId: id }); setOpen(false); };

  // 新建与改都走同一个表单。改一条接口，用到它的服务全都跟着变，
  // 这正是「各页面各填一遍」解决不了的那件事
  const save = () => {
    const name = String(making.name || '').trim();
    if (!name) { toast('请填写名称'); return; }
    if (!making.apiKey.trim()) { toast('请填写密钥'); return; }
    if (making.id) {
      svc.updateEndpoint(making.id, { name, baseUrl: making.baseUrl, apiKey: making.apiKey });
      setMaking(null);
      toast(`已更新「${name}」`, 'ok');
      return;
    }
    const row = svc.addEndpoint(making);
    setMaking(null);
    use(row.id);
    toast(`已保存「${row.name}」`, 'ok');
  };

  const drop = async e => {
    if (!await confirm({
      title: `删除「${e.name}」`, danger: true, okText: '删除',
      message: '正在使用它的服务将退回各自填写的地址与密钥。',
    })) return;
    svc.removeEndpoint(e.id);
    toast('已删除');
  };

  return html`
    <${List} title=${label}>
      <${ListItem} title=${src ? src.name : '在下面直接填写'} multiline arrow
        subtitle=${src
          ? `${src.kind === 'chat' ? '来自聊天预设' : '自建的接口'} · ${src.baseUrl || '未填地址'}`
            + '。改动这个来源时，用到它的服务会一起变'
          : '这套服务使用自己的地址与密钥。也可以改为引用一个已有的接口'}
        left=${html`<${Icon} name=${src ? 'layers' : 'edit'} size=${18}/>`}
        onClick=${() => setOpen(true)}/>
    <//>

    <${Sheet} open=${open} onClose=${() => { setOpen(false); setMaking(null); }}
      title="选择接口来源" height="82%">
      ${making ? html`
        <div class="pad-x">
          <${Field} label="名称" desc="只用于在这里认出它，随便起">
            <${Input} value=${making.name} placeholder="例如 SiliconFlow"
              onInput=${v => setMaking({ ...making, name: v })}/>
          <//>
          <${Field} label="接口地址">
            <${Input} value=${making.baseUrl} placeholder="https://api.siliconflow.cn"
              onInput=${v => setMaking({ ...making, baseUrl: v.trim() })}/>
          <//>
          <${Field} label="密钥">
            <${Input} type="password" value=${making.apiKey} placeholder="sk-..."
              onInput=${v => setMaking({ ...making, apiKey: v.trim() })}/>
          <//>
        </div>
        <div class="pad batch-acts">
          <${Button} onClick=${save}>${making.id ? '保存' : '保存并使用'}<//>
          <${Button} variant="ghost" onClick=${() => setMaking(null)}>返回<//>
        </div>
      ` : html`
        <${List} inset=${false}>
          <${ListItem} title="在下面直接填写" multiline
            subtitle="这套服务使用自己的地址与密钥，不引用别处"
            left=${html`<${Icon} name="edit" size=${18}/>`}
            right=${!cfg.endpointId ? html`<${Icon} name="check" size=${16}/>` : null}
            onClick=${() => use('')}/>
        <//>

        ${chat.length ? html`
          <${List} inset=${false} title="聊天预设">
            ${chat.map(p => html`
              <${ListItem} key=${p.id} title=${p.name} multiline
                subtitle=${p.baseUrl || '未填地址'}
                left=${html`<${Icon} name="message" size=${18}/>`}
                right=${cfg.endpointId === p.id ? html`<${Icon} name="check" size=${16}/>` : null}
                onClick=${() => use(p.id)}/>`)}
          <//>` : null}

        ${own.length ? html`
          <${List} inset=${false} title="自建的接口">
            ${own.map(e => html`
              <${ListItem} key=${e.id} title=${e.name} multiline
                subtitle=${e.baseUrl || '未填地址'}
                left=${html`<${Icon} name="database" size=${18}/>`}
                right=${html`
                  <span class="row-acts">
                    ${cfg.endpointId === e.id ? html`<${Icon} name="check" size=${16}/>` : null}
                    <button class="press" aria-label="编辑"
                      onClick=${ev => { ev.stopPropagation(); setMaking({ ...e }); }}>
                      <${Icon} name="edit" size=${16}/>
                    </button>
                    <button class="press" aria-label="删除"
                      onClick=${ev => { ev.stopPropagation(); drop(e); }}>
                      <${Icon} name="trash" size=${16}/>
                    </button>
                  </span>`}
                onClick=${() => use(e.id)}/>`)}
          <//>` : null}

        <div class="pad">
          <${Button} full variant="ghost" icon="plus"
            onClick=${() => setMaking({ name: '', baseUrl: '', apiKey: '' })}>
            新建一个接口
          <//>
        </div>
        <div class="settings-foot">
          选了来源之后，这套服务的地址与密钥跟着来源走。改一次来源，
          用到它的服务全都更新，不必逐个页面再填一遍。
        </div>
      `}
    <//>`;
}
