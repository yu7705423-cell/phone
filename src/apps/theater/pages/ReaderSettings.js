import { html, useState, useEffect, useRef } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';
import { Sheet, List, ListItem, Field, Input, NumberInput, Segmented, Switch,
         Icon, Button, toast, confirm } from '../../../ui/index.js';

const { reader, db } = phone;

// 阅读器的外观。和全局主题分开，改这里不动 app 的皮肤。
export function ReaderSettings({ open, onClose }) {
  const cfg = reader.get();
  const [fontOk, setFontOk] = useState(null);
  const fileRef = useRef(null);

  const set = patch => { reader.set(patch); };

  useEffect(() => {
    if (!open || !cfg.fontFamily) { setFontOk(null); return; }
    let alive = true;
    reader.fontStatus(cfg.fontFamily).then(v => { if (alive) setFontOk(v); });
    return () => { alive = false; };
  }, [open, cfg.fontFamily, cfg.fontUrl]);

  const onUrl = v => {
    const url = v.trim();
    // 字体文件的链接能推出名字；样式表推不出来，得自己填
    const guess = reader.familyFromUrl(url);
    set(guess && !cfg.fontFamily ? { fontUrl: url, fontFamily: guess } : { fontUrl: url });
  };

  const pickBg = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { await reader.setBgImage(file); toast('已更换背景', 'ok'); }
    catch (err) { toast('图片处理失败：' + (err.message || err), 'error', 4000); }
  };

  if (!open) return null;
  const custom = cfg.paper === 'custom';

  return html`
    <${Sheet} open=${true} onClose=${onClose} title="阅读设置" height="88%">
      <${List} title="阅读时" inset=${false}>
        <${ListItem} title="全屏阅读" multiline
          subtitle="隐藏顶栏与翻页条，整屏只剩正文。点正文中间可以再唤出来"
          right=${html`<${Switch} checked=${cfg.fullscreen}
            onChange=${v => set({ fullscreen: v })}/>`}/>
        <${ListItem} title="点两侧翻页" multiline
          subtitle="点屏幕左侧三分之一向前，右侧三分之一向后，中间呼出顶栏"
          right=${html`<${Switch} checked=${cfg.tapTurn}
            onChange=${v => set({ tapTurn: v })}/>`}/>
      <//>

      <${List} title="翻页方式" inset=${false}>
        ${reader.EFFECTS.map(e => html`
          <${ListItem} key=${e.id} title=${e.label} subtitle=${e.desc} multiline
            right=${cfg.effect === e.id ? html`<${Icon} name="check" size=${16}/>` : null}
            onClick=${() => set({ effect: e.id })}/>`)}
      <//>

      <div class="pad-x pad-t">
        <${Field} label="纸色"
          desc="仅在阅读器内生效，与「设置 - 主题」互不影响。选择「自定义」后可以填颜色或选一张图片。">
          <${Segmented} value=${cfg.paper} onChange=${v => set({ paper: v })}
            items=${reader.PAPERS.map(p => ({ value: p.id, label: p.label }))}/>
        <//>

        ${custom ? html`
          <${Field} label="背景颜色" desc="留空则只用背景图片，两者都留空时跟随主题。">
            <div class="rd-color">
              <input type="color" class="rd-swatch" value=${cfg.bgColor || '#ffffff'}
                onInput=${e => set({ bgColor: e.target.value })}/>
              <${Input} value=${cfg.bgColor} placeholder="#ffffff"
                onInput=${v => set({ bgColor: v.trim() })}/>
              ${cfg.bgColor ? html`
                <${Button} size="sm" variant="ghost"
                  onClick=${() => set({ bgColor: '' })}>清除<//>` : null}
            </div>
          <//>
          <${Field} label="背景图片" desc="铺满整个阅读区。图片较暗时记得一并调整正文颜色。">
            <div class="batch-acts">
              <${Button} size="sm" variant="ghost" icon="image"
                onClick=${() => fileRef.current?.click()}>选择图片<//>
              ${cfg.bgImage ? html`
                <${Button} size="sm" variant="ghost"
                  onClick=${() => { reader.clearBgImage(); toast('已去掉背景图片'); }}>去掉<//>` : null}
            </div>
          <//>
          <${Field} label="正文颜色" desc="留空则跟随纸色自动取黑或白。">
            <div class="rd-color">
              <input type="color" class="rd-swatch" value=${cfg.textColor || '#000000'}
                onInput=${e => set({ textColor: e.target.value })}/>
              <${Input} value=${cfg.textColor} placeholder="跟随纸色"
                onInput=${v => set({ textColor: v.trim() })}/>
              ${cfg.textColor ? html`
                <${Button} size="sm" variant="ghost"
                  onClick=${() => set({ textColor: '' })}>清除<//>` : null}
            </div>
          <//>` : null}

        <${Field} label="字号">
          <${NumberInput} value=${cfg.fontSize} unit="px"
            onChange=${v => set({ fontSize: Math.max(10, Math.min(40, v || 17)) })}/>
        <//>
        <${Field} label="行距" desc="正文每行之间的倍数。1.8 左右较为宽松。">
          <${Input} value=${String(cfg.lineHeight)} placeholder="1.85"
            onInput=${v => {
              const n = Number(v);
              if (Number.isFinite(n) && n >= 1 && n <= 4) set({ lineHeight: n });
            }}/>
        <//>

        <${Field} label="字体链接"
          desc="两种链接都可以：声明字体的样式表，或者字体文件本身（.ttf / .otf / .woff2）。
            两者的挂载方式不同，这里按扩展名自动分流。只作用于阅读器的正文。">
          <${Input} value=${cfg.fontUrl} placeholder="https://… 可留空"
            onInput=${onUrl}/>
        <//>
        <${Field} label="字体名称"
          desc=${'样式表里声明的字体名，必须与其中的 font-family 完全一致。'
            + '这个名字无法从链接推断，需要自行填写；填错的表现与未生效相同。'}>
          <${Input} value=${cfg.fontFamily} placeholder="例如 Noto Serif SC"
            onInput=${v => set({ fontFamily: v.trim() })}/>
        <//>
        ${cfg.fontFamily ? html`
          <div class="settings-foot">
            ${fontOk === null ? '正在检查字体是否可用。'
              : fontOk ? `字体「${cfg.fontFamily}」已加载。`
              : `字体「${cfg.fontFamily}」未能加载。常见原因：名称与样式表中的不一致，`
                + '或者该地址未开放跨域访问。'}
          </div>` : null}

        <div class="pad-b pad-t">
          <${Button} full variant="ghost" onClick=${async () => {
            if (!await confirm({ title: '恢复默认外观' })) return;
            reader.reset(); toast('已恢复默认', 'ok');
          }}>恢复默认<//>
        </div>
      </div>

      <input type="file" accept="image/*" ref=${fileRef} onChange=${pickBg} style="display:none"/>
    <//>`;
}
