import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea } from '../../ui/index.js';

const { db, nav, ban } = phone;

export function BanPage() {
  useStore(db.settings.store);
  const s = db.settings.get();
  const listed = ban.list();
  // 输入框自己管自己的草稿：每敲一个字都回写设置的话，中间那些半截的词
  // 会被当成词条存下来，光标也会跳
  const [draft, setDraft] = useState(null);
  const text = draft ?? listed.join('\n');

  const save = v => { setDraft(v); ban.setList(v); };

  return html`
    <${Page} title="不要写这些" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          列出不希望角色使用的词句，每行一条。该列表对所有角色生效，默认为空。
          列出的内容会写入每一轮的提示词，同时在回复落地时本地比对一次：
          命中的条目标注在该条消息下方。
        </div>
      </div>

      <div class="pad">
        <${Field} label="词句列表"
          desc=${'每行一条。星号可匹配任意内容，例如「把*揉进骨血里」'
            + '亦可匹配中间人称不同的写法，跨度以十二字为限。'
            + '条目中的空格不参与比对。'}>
          <${Textarea} rows=${10} value=${text}
            placeholder=${'空气中弥漫着\n不易察觉的\n把*揉进骨血里'}
            onInput=${save} onBlur=${() => setDraft(null)}/>
        <//>

        <${Field} label="命中后重新生成"
          desc=${'角色的回复命中列表中的条目时，自动重新生成。'
            + '每重新生成一次，即额外调用一次接口，费用相应增加。'
            + '填 0 表示不重新生成，仅在该条消息下方标注。'
            + '重新生成前的内容保留为候选，可在气泡下方左右切换查看。'}>
          <${Input} type="number" inputmode="numeric" value=${String(s.banReroll ?? 0)}
            onInput=${v => db.settings.set({ banReroll: Math.max(0, Math.round(Number(v) || 0)) })}/>
        <//>
      </div>

      <${List} title="当前状态">
        <${ListItem} title=${`已列出 ${listed.length} 条`} multiline
          subtitle=${listed.length
            ? (Number(s.banReroll) > 0
              ? `命中时最多重新生成 ${Math.max(0, Math.round(Number(s.banReroll) || 0))} 次`
              : '命中时仅标注，不重新生成')
            : '列表为空时，提示词中不出现该段落，也不进行比对。'}/>
      <//>
    <//>`;
}
