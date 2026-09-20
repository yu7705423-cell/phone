import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, NumberInput, Switch, Icon } from '../../ui/index.js';

const { db, nav, ai } = phone;

// 用量与上限。见 CLAUDE.md 第 13 条：
//   一次能做多少，一律不封顶，这里填的是默认值，0 表示不限；
//   要花钱、要多跑几轮接口的，一律能改、能关。
//
// 这一页只放跟具体对象无关的旋钮。属于某个角色的（这个角色要不要主动找我、
// 多久找一次）按第 5 条留在角色自己的页面里，不往这儿搬。
export function LimitsPage() {
  const s = useStore(db.settings.store);
  const set = patch => db.settings.set(patch);
  // 现在开着哪几项会多打接口。清单只在 ai/cost.js 列一处
  const extra = ai.cost.active();
  // 重试与换套是相乘的。这个数从 ai/cost.js 来，界面不自己再算一遍
  const attempts = ai.cost.attemptsPerCall();

  return html`
    <${Page} title="用量与上限" onBack=${nav.pop}>
      <div class="settings-foot">
        以下数值均填 0 表示不限。这里给出的是默认值，不是硬性上限，可按需要调大。
        标注了「每次请求」的项目直接影响接口费用。
      </div>

      <${List} title="一次回复调用几次接口">
        <${ListItem} title=${extra.length ? `基础 1 次，另有 ${extra.length} 项已开启` : '1 次'}
          multiline
          left=${html`<${Icon} name=${extra.length ? 'filter' : 'check'} size=${18}/>`}
          subtitle=${extra.length
            ? '以下项目会在某些条件下追加调用。逐项说明见下方各开关。'
            : '一次回复只调用一次接口。开启下列任一项后，某些回合会追加调用。'}/>
        ${extra.map(x => html`
          <${ListItem} key=${x.id} title=${x.label} subtitle=${x.whenText} multiline/>`)}
        ${attempts > 1 ? html`
          <${ListItem} title=${`请求失败时，每一次调用会变成 ${attempts} 个请求`} multiline
            left=${html`<${Icon} name="filter" size=${18}/>`}
            subtitle=${'「自动重试」与「接口失败时改用另一套」是相乘的关系，不是相加：'
              + '换用另一套本身是第二个请求，而重试重的是整轮，连同那次换套一并重来。'
              + `当前设置下，一次失败的回复最多发出 ${attempts} 个请求，每个都计费。`}/>` : null}
      <//>

      <${List} title="额外的接口调用">
        <${ListItem} title="一次总结吃掉多少条消息" multiline
          subtitle=${'总结记忆时，一次最多拿最早的这么多条消息去拼请求。填 0 表示一次全拿。'
            + '从别处迁入大量历史时，不设这个数会把几万条当成一轮拼进一次请求，'
            + '要么超出上下文报错，要么真的发出去。剩下的下次接着总结。'}
          right=${html`<${NumberInput} value=${Number(s.memoryBatch) || 0} min=${0}
            onChange=${v => set({ memoryBatch: v })}/>`}/>
        <${ListItem} title="自动重试" multiline
          subtitle=${`接口返回 429 或 5xx 时自动重发。每重试一次即多一次计费。`
            + `填 0 表示不重试，最多 ${ai.cost.RETRY_CAP} 次。主动取消不计为失败，不会重试。`}
          right=${html`<${NumberInput} value=${Number(s.retryMax) || 0} min=${0}
            max=${ai.cost.RETRY_CAP} onChange=${v => set({ retryMax: v })}/>`}/>
        <${ListItem} title="接口失败时改用另一套" multiline
          subtitle=${s.chatFallback === true
            ? '主用接口报错时改用副用接口重发一次，失败的那次同样计费。'
            : '已关闭。接口报错时直接报错，不改用另一套重发。开启后失败的回合会调用两次。'}
          right=${html`<${Switch} checked=${s.chatFallback === true}
            onChange=${v => set({ chatFallback: v })}/>`}/>
        <${ListItem} title="自动生成关系底色" multiline
          subtitle=${s.bondAuto !== true
            ? '已关闭。关系底色不会自动更新，可在会话菜单中手动生成或手写。'
            : '标记为 S 级的记忆有增删改时，额外调用一次接口，将其压缩为几句关系现状。'
              + '未发生变动时不调用。关闭后仍可手动生成。'}
          right=${html`<${Switch} checked=${s.bondAuto === true}
            onChange=${v => set({ bondAuto: v })}/>`}/>
        <${ListItem} title="导入角色卡时生成核心设定" multiline
          subtitle=${s.coreAuto === false
            ? '已关闭。核心设定需在编辑资料中自行填写。'
            : '导入角色卡时额外调用一次接口，将人设压缩为三到五行，注入在 prompt 末尾。'
              + '关闭后该字段留空，可自行填写。'}
          right=${html`<${Switch} checked=${s.coreAuto !== false}
            onChange=${v => set({ coreAuto: v })}/>`}/>
      <//>

      <div class="list-title">发给模型的内容</div>
      <div class="pad-x pad-b">
        <${Field} label="本轮相关记忆的注入深度"
          desc="召回的记忆插入对话历史中倒数第几条消息之前。
            数值越小越接近当前对话，模型越不容易忽略。
            填 0 表示不插入对话，改为放在设定区最前部，
            此时后续所有内容的接口缓存会在每轮失效，费用与延迟都会上升。">
          <${NumberInput} value=${s.memoryDepth} unit="条" placeholder="放在设定区"
            onChange=${v => set({ memoryDepth: v })}/>
        <//>

        <${Field} label="通话每轮回复上限"
          desc="通话中模型每轮回复的 token 上限，每次请求都会用到。
            数值偏小时角色在电话里说一两句就停，接近日常通话的节奏；
            填 0 表示不限，改用接口本身的上限，回复可能变成大段独白。">
          <${NumberInput} value=${s.callMaxTokens} unit="token" placeholder="不限"
            onChange=${v => set({ callMaxTokens: v })}/>
        <//>

        <${Field} label="视频通话画面间隔"
          desc="视频通话中两帧画面之间至少间隔的秒数。
            仅在开启「让角色看见我」时生效，每传一帧都是一次图片费用。
            填 0 表示每轮都带一帧，画面最新，费用也最高。">
          <${NumberInput} value=${s.callFrameGap} unit="秒" placeholder="每轮都带"
            onChange=${v => set({ callFrameGap: v })}/>
        <//>

        <${Field} label="表情名单长度（平时）"
          desc="平时在能力清单中列出的表情包名称数量，按使用次数由多到少排列。
            模型只能使用列出来的名称。填 0 表示全部列出，表情包较多时会明显增加
            每次请求的长度。">
          <${NumberInput} value=${s.stickerCold} unit="个" placeholder="全部"
            onChange=${v => set({ stickerCold: v })}/>
        <//>

        <${Field} label="总结记忆的输出上限"
          desc="总结记忆时模型一次最多写多少 token。
            数值偏小时输出会在半路截断，那一次调用仍然照付，能救回来的只有已经写完的几条。
            填 0 表示不限，改用接口本身的上限；上限只是封顶，没有用到的部分不计费。">
          <${NumberInput} value=${s.memoryExtractMaxTokens} unit="token" placeholder="不限"
            onChange=${v => set({ memoryExtractMaxTokens: v })}/>
        <//>

        <${Field} label="总结时发多少条已有记忆"
          desc="总结记忆时会把已有的记忆一并发给模型，用于去重和改写旧条目。
            条数越多重复越少，每次请求也越长。裁剪时按等级保留，S 级与 A 级优先。
            填 0 表示全部发送。">
          <${NumberInput} value=${s.memoryDedupeList} unit="条" placeholder="全部"
            onChange=${v => set({ memoryDedupeList: v })}/>
        <//>

        <${Field} label="记忆导入的分段长度"
          desc="从文本导入记忆时，每段发送的字数。每段是一次单独的接口调用，
            段越短调用次数越多。填 0 表示不分段，整段一次发完，调用一次。
            分段过长时模型可能漏掉其中的内容。">
          <${NumberInput} value=${s.memoryImportChunk} unit="字" placeholder="不分段"
            onChange=${v => set({ memoryImportChunk: v })}/>
        <//>

        <${Field} label="批量生成时发多少条已有词条"
          desc="批量生成随机事件时，会把该格已有的词条一并发给模型以避免重复。
            条数越多重复越少，每次请求也越长。填 0 表示全部发送。
            无论此处如何设置，入库时都会再比对一次。">
          <${NumberInput} value=${s.eventDedupeList} unit="条" placeholder="全部"
            onChange=${v => set({ eventDedupeList: v })}/>
        <//>

        <${Field} label="表情名单长度（最近用过时）"
          desc="最近的消息中出现过表情包时改用这个数量。
            此时角色正在用表情，给出的名称越多可选范围越大。填 0 表示全部列出。">
          <${NumberInput} value=${s.stickerHot} unit="个" placeholder="全部"
            onChange=${v => set({ stickerHot: v })}/>
        <//>
      </div>

      <div class="list-title">主动消息</div>
      <div class="pad-x pad-b">
        <${Field} label="未读达到多少条就不再发"
          desc="角色主动发起对话时的自我约束。未读消息堆到这个数量后暂停主动发送，
            直到你打开会话。仅在该角色开启了主动消息时生效。
            填 0 表示不受未读数限制，会按设定的间隔持续发送，接口调用随之持续产生。">
          <${NumberInput} value=${s.proactiveMaxUnread} unit="条" placeholder="不限"
            onChange=${v => set({ proactiveMaxUnread: v })}/>
        <//>
      </div>

      <div class="list-title">界面</div>
      <div class="pad-x pad-b">
        <${Field} label="会话一次渲染多少条"
          desc="打开会话时先渲染最近的这些消息，再往上翻会按同样的数量继续加载。
            不影响发给模型的内容，只影响打开速度。
            填 0 表示一次渲染全部，消息很多的会话打开时会明显卡顿。">
          <${NumberInput} value=${s.chatPage} unit="条" placeholder="全部"
            onChange=${v => set({ chatPage: v })}/>
        <//>

        <${Field} label="搜索结果上限"
          desc="搜索聊天记录时最多返回的条数。凑满即停，因此常见词能很快出结果。
            填 0 表示全部返回，此时每次搜索都要扫完全部消息，记录很多时会变慢。">
          <${NumberInput} value=${s.searchLimit} unit="条" placeholder="全部"
            onChange=${v => set({ searchLimit: v })}/>
        <//>
      </div>

      <div class="list-title">一起听</div>
      <div class="pad-x pad-b">
        <${Field} label="播放多久才算听过"
          desc="一首歌播放满这个时长后，才向已登录的音乐账号上报一次播放记录。
            仅在配置了音乐服务并登录后生效。
            填 0 表示一开始播放就上报，切歌频繁时会产生较多请求。">
          <${NumberInput} value=${s.scrobbleAfter} unit="秒" placeholder="立即上报"
            onChange=${v => set({ scrobbleAfter: v })}/>
        <//>
      </div>

      <div class="list-title">一起看与一起读</div>
      <${List}>
        <${ListItem} title="在「一起看」中调整" arrow multiline
          subtitle="她自行开口的间隔、每次给她看几句台词或多少字正文、离开之后多久收场。
            这几项与那个应用绑在一起，因此放在它自己的设置里"
          onClick=${() => phone.intent.open('theater', { route: '/settings', back: true })}/>
      <//>

      <div class="settings-foot">
        历史范围、注入预算、记忆条数在会话右上角的「上下文」中设置。
        某个角色是否主动发起对话、间隔多久，在该角色的会话菜单中设置。
      </div>
    <//>`;
}
