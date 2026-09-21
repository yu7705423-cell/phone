import { html, useRef } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, NumberInput,
         Switch, Icon, Button, toast, confirm } from '../../../ui/index.js';

const { db, nav, stage, reader, scene: sceneApi } = phone;

// 线下的外观。和全局主题、和阅读器都分开 —— 线下想要的纸色字号，
// 和读书时想要的不是一回事。见 ARCHITECTURE 4.107
//
// 带 sceneId 进来时改的是那一场自己的那份，盖在全局之上（第 5 条）。

const SWATCHES = [
  { key: 'bgColor', label: '底色', fallback: '#ffffff', desc: '整页的底。' },
  { key: 'ink', label: '正文颜色', fallback: '#000000', desc: '正文与标题。' },
  { key: 'dim', label: '次要颜色', fallback: '#777777', desc: '刊头、页码、动作描写。' },
  { key: 'line', label: '细线颜色', fallback: '#dddddd', desc: '分隔线与邮戳内圈。' },
  { key: 'mark', label: '标记颜色', fallback: '#27405e', desc: '邮戳与强调处。' },
];

export function StageSettings({ sceneId }) {
  useStore(db.settings.store);
  useStore(db.scenes.store);
  const fileRef = useRef(null);

  const row = sceneId ? sceneApi.get(sceneId) : null;
  const scoped = !!row;
  const cfg = scoped ? stage.forScene(row) : stage.get();

  const set = patch => {
    if (scoped) sceneApi.update(sceneId, { stage: { ...(row.stage || {}), ...patch } });
    else stage.set(patch);
  };

  const pickBg = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = await stage.setBgImage(file);
      if (scoped) set({ bgImage: id });
      toast('已更换壁纸', 'ok');
    } catch (err) { toast('图片处理失败：' + (err.message || err), 'error', 4000); }
  };

  const clearScoped = async () => {
    const ok = await confirm({
      title: '恢复为全局外观', message: '这一场单独设定的外观将被清除。', okText: '清除',
    });
    if (ok) { sceneApi.update(sceneId, { stage: null }); toast('已清除', 'ok'); }
  };

  return html`
    <${Page} title=${scoped ? '这一场的外观' : '线下外观'} onBack=${nav.pop}>
      ${scoped ? html`
        <${List}>
          <${ListItem} title="恢复为全局外观" multiline
            subtitle="清除这一场单独设定的部分，改回「设置 - 线下外观」里的那一套"
            onClick=${clearScoped}/>
        <//>` : null}

      <${List} title="主题" inset=${false}>
        ${stage.THEMES.map(t => html`
          <${ListItem} key=${t.id} title=${t.label}
            subtitle=${t.id === 'custom' ? '保留当前颜色，自行调整' : ''}
            multiline=${t.id === 'custom'}
            right=${cfg.theme === t.id ? html`<${Icon} name="check" size=${16}/>` : null}
            onClick=${() => {
    if (scoped) set({ theme: t.id, ...(t.id === 'custom' ? {} : {
      bgColor: t.bg, ink: t.ink, dim: t.dim, line: t.line, mark: t.mark, serif: t.serif,
    }) });
    else stage.useTheme(t.id);
  }}/>`)}
      <//>

      <${List} title="版式" inset=${false}>
        ${stage.LAYOUTS.map(x => html`
          <${ListItem} key=${x.id} title=${x.label} subtitle=${x.desc} multiline
            right=${cfg.layout === x.id ? html`<${Icon} name="check" size=${16}/>` : null}
            onClick=${() => set({ layout: x.id })}/>`)}
      <//>

      <${List} title="正文" inset=${false}>
        <${ListItem} title="铺满屏幕" multiline
          subtitle="开启后正文占据整个屏幕，刊头、页码与底栏不再显示。关闭时正文在固定区域内滚动"
          right=${html`<${Switch} checked=${cfg.spread} onChange=${v => set({ spread: v })}/>`}/>
        ${cfg.layout !== 'cards' ? html`
          <${ListItem} title="点两侧翻页" multiline
            subtitle="点屏幕左侧三分之一向前，右侧三分之一向后，中间切换是否铺满屏幕"
            right=${html`<${Switch} checked=${cfg.tapTurn} onChange=${v => set({ tapTurn: v })}/>`}/>` : null}
      <//>

      <${List} title="署名" inset=${false}>
        ${stage.SIGNS.map(x => html`
          <${ListItem} key=${x.id} title=${x.label} subtitle=${x.desc} multiline
            right=${cfg.sign === x.id ? html`<${Icon} name="check" size=${16}/>` : null}
            onClick=${() => set({ sign: x.id })}/>`)}
      <//>

      <${List} title="排版" inset=${false}>
        <${ListItem} title="首字下沉" multiline
          subtitle="每段第一张的第一个字放大到两行多高，杂志开篇那一页的排法。开头是标点的那一段不做"
          right=${html`<${Switch} checked=${cfg.drop} onChange=${v => set({ drop: v })}/>`}/>
        ${cfg.layout === 'cards' ? html`
          <${ListItem} title="明信片铺开文字" multiline
            subtitle="开启后每片跟着内容长，长的一段就是长的一片。关闭时每片一样大，按明信片的比例，文字在片内滚动"
            right=${html`<${Switch} checked=${cfg.cardGrow !== false}
              onChange=${v => set({ cardGrow: v })}/>`}/>` : null}
        <${ListItem} title="区分对白与动作" multiline
          subtitle="引号内按对白显示，括号或星号内按动作显示。仅影响显示，不改变正文，也不写入提示词"
          right=${html`<${Switch} checked=${cfg.marks} onChange=${v => set({ marks: v })}/>`}/>
        <${ListItem} title="衬线字体" multiline
          subtitle="正文使用宋体一类的衬线字体。关闭后使用黑体一类的无衬线字体"
          right=${html`<${Switch} checked=${cfg.serif} onChange=${v => set({ serif: v })}/>`}/>
      <//>

      ${cfg.layout === 'cards' ? null : html`
      <${List} title="翻页方式" inset=${false}>
        ${reader.EFFECTS.map(e => html`
          <${ListItem} key=${e.id} title=${e.label} subtitle=${e.desc} multiline
            right=${cfg.effect === e.id ? html`<${Icon} name="check" size=${16}/>` : null}
            onClick=${() => set({ effect: e.id })}/>`)}
      <//>`}

      <div class="pad-x pad-t">
        <${Field} label="一张多少字"
          desc="一段超过这个字数就续成下一张。填 0 表示不切分，整段在一张里滚动。">
          <${NumberInput} value=${cfg.pageChars} unit="字" placeholder="不切分"
            onChange=${v => set({ pageChars: Math.max(0, v || 0) })}/>
        <//>
        <${Field} label="一行多少字" desc="正文栏的宽度。三十到三十八字之间较易阅读。">
          <${NumberInput} value=${cfg.measure} unit="字"
            onChange=${v => set({ measure: Math.max(12, Math.min(90, v || 34)) })}/>
        <//>
        <${Field} label="字号">
          <${NumberInput} value=${cfg.fontSize} unit="px"
            onChange=${v => set({ fontSize: Math.max(10, Math.min(40, v || 17)) })}/>
        <//>
        <${Field} label="行距" desc="每行之间的倍数。1.9 左右较为宽松。">
          <${Input} value=${String(cfg.lineHeight)} placeholder="1.9"
            onInput=${v => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 1 && n <= 4) set({ lineHeight: n });
  }}/>
        <//>
        <${Field} label="段距" desc="段落之间空开多少行。">
          <${Input} value=${String(cfg.paraGap)} placeholder="1"
            onInput=${v => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n <= 4) set({ paraGap: n });
  }}/>
        <//>

        ${SWATCHES.map(sw => html`
          <${Field} key=${sw.key} label=${sw.label} desc=${sw.desc}>
            <div class="rd-color">
              <input type="color" class="rd-swatch" value=${cfg[sw.key] || sw.fallback}
                onInput=${e => set({ [sw.key]: e.target.value, theme: 'custom' })}/>
              <${Input} value=${cfg[sw.key] || ''} placeholder=${sw.fallback}
                onInput=${v => set({ [sw.key]: v.trim(), theme: 'custom' })}/>
              ${cfg[sw.key] ? html`
                <${Button} size="sm" variant="ghost"
                  onClick=${() => set({ [sw.key]: '' })}>清除<//>` : null}
            </div>
          <//>`)}

        <${Field} label="壁纸" desc="铺满整页。图片较暗时一并调整正文颜色。">
          <div class="batch-acts">
            <${Button} size="sm" variant="ghost" icon="image"
              onClick=${() => fileRef.current?.click()}>选择图片<//>
            ${cfg.bgImage ? html`
              <${Button} size="sm" variant="ghost"
                onClick=${() => { if (scoped) set({ bgImage: null }); else stage.clearBgImage(); }}>
                去掉
              <//>` : null}
          </div>
        <//>

        <${Field} label="字体链接"
          desc="两种链接都可以：声明字体的样式表，或者字体文件本身。两者的挂载方式不同，按扩展名自动分流。">
          <${Input} value=${cfg.fontUrl} placeholder="https://… 可留空"
            onInput=${v => {
    const url = v.trim();
    const guess = reader.familyFromUrl(url);
    set(guess && !cfg.fontFamily ? { fontUrl: url, fontFamily: guess } : { fontUrl: url });
  }}/>
        <//>
        <${Field} label="字体名称" desc="样式表里声明的字体名，必须与其中的 font-family 完全一致。">
          <${Input} value=${cfg.fontFamily} placeholder="留空则使用系统字体"
            onInput=${v => set({ fontFamily: v.trim() })}/>
        <//>

        <${Field} label="自定义样式"
          desc="填写 CSS。仅在线下页面打开时生效，离开后立即移除，不影响其他界面。正文的容器是 .sg，段落是 .sg-text p，邮戳是 .sg-stamp。">
          <${Textarea} rows=${8} value=${cfg.css} placeholder=".sg-text p { text-indent: 2em; }"
            onInput=${v => set({ css: v })}/>
        <//>

        ${!scoped ? html`
          <div class="pad-t">
            <${Button} variant="ghost" onClick=${async () => {
    const ok = await confirm({ title: '恢复默认外观', message: '全部外观设定将回到默认值。', okText: '恢复' });
    if (ok) { stage.reset(); toast('已恢复', 'ok'); }
  }}>恢复默认<//>
          </div>` : null}
      </div>

      <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${pickBg}/>
    <//>`;
}
