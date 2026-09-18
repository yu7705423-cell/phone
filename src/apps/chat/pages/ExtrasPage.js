import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Segmented, Icon, EmptyState } from '../../../ui/index.js';

const { db, nav, extras } = phone;

const MODES = [
  { value: extras.INNER_OFF, label: '关闭' },
  { value: extras.INNER_INLINE, label: '随回复一起' },
  { value: extras.INNER_APART, label: '单独生成' },
];
const STYLES = extras.INNER_STYLES.map(s => ({ value: s.id, label: s.label }));
const FACE_ITEMS = extras.FACES.map(n => ({ value: n, label: `${n} 面` }));

// 三档一次列全，不是只讲当前这一档。
// 「开了会多花什么」得在**开之前**就看得见（CLAUDE.md 第 13 条），
// 切过去之后才告诉用户要多花钱，等于没说。
const MODE_DESC = `关闭：角色只说出口的那些话。
随回复一起：角色在同一次回复里多写一行心声，不额外调用接口；心声与台词出自同一次生成，两者会互相迁就。
单独生成：每轮说完后另起一次调用，只问这几句话背后在想什么，写出来更像背面那一层；代价是每轮多一次接口调用，费用随之增加。`;

// 互动。三样小件凑一页：它们都长在这段关系上，用户想改的时候人正在会话里。
export function ExtrasPage({ chatId }) {
  const s = useStore(db.settings.store);
  useStore(db.chats.store);
  useStore(db.characters.store);

  const chat = db.chats.get(chatId);
  const char = chat ? db.characters.get((chat.characterIds || [])[0]) : null;

  if (!chat || !char) {
    return html`
      <${Page} title="互动" onBack=${nav.pop}>
        <${EmptyState} icon="heart" title="这段对话已不存在"/>
      <//>`;
  }

  const mode = extras.innerMode(chat);
  const on = extras.innerOn(chat);

  return html`
    <${Page} title="互动" onBack=${nav.pop}>
      <${List} title="心声"/>
      <div class="pad-x pad-b">
        <${Field} label="怎么产出" desc=${MODE_DESC}>
          <${Segmented} value=${mode} items=${MODES}
            onChange=${v => extras.setInnerMode(chatId, v)}/>
        <//>
        ${on ? html`
          <${Field} label="显示成什么样"
            desc="心声默认隐藏，点角色头像展开。此项对所有会话生效。">
            <${Segmented} value=${extras.innerStyle()} items=${STYLES}
              onChange=${v => extras.setInnerStyle(v)}/>
          <//>` : null}
      </div>
      <div class="settings-foot">
        心声的提示词在「Prompt 模板」中，随回复一起的那一档是「骨架 · 心声」，
        单独生成的那一档是「任务 · 心声」。
      </div>

      <${List} title="拍一拍"/>
      <div class="pad-x pad-b">
        <${Field} label="别人拍我时显示的后缀"
          desc=${`双击头像即可拍一拍。后缀由被拍的一方设定，`
            + `所以这一项是角色拍你时显示的。拍角色时显示的是角色卡中的那一项。`
            + `留空则使用「${extras.DEFAULT_PAT}」。`}>
          <${Input} value=${s.patSuffix || ''} placeholder=${extras.DEFAULT_PAT}
            onInput=${v => extras.setMyPat(v)}/>
        <//>
        <div class="chip-row">
          ${extras.PAT_SUFFIXES.map(x => html`
            <button key=${x} class=${`chip${(s.patSuffix || extras.DEFAULT_PAT) === x ? ' is-active' : ''}`}
              onClick=${() => extras.setMyPat(x)}>${x}</button>`)}
        </div>
      </div>

      <${List} title="骰子"/>
      <div class="pad-x pad-b">
        <${Field} label="几面"
          desc=${`点数由本地随机数掷出，不由模型生成。角色也可以掷，`
            + `但掷出的那一条要到下一轮才进入上下文，所以它写下那一行时还不知道点数。`}>
          <${Segmented} value=${extras.facesOf(chat)} items=${FACE_ITEMS}
            onChange=${v => extras.setFaces(chatId, v)}/>
        <//>
      </div>

      <div class="settings-foot">
        特别关心、拍一拍后缀、以及角色能不能主动拍你、掷骰子、换头像，
        都在「角色卡」中设置。
      </div>
    <//>`;
}
