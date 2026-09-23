import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, NumberInput, Switch, Icon,
         prompt, toast } from '../../ui/index.js';

const { db, nav, ai } = phone;

// 用量与上限。见 CLAUDE.md 第 13 条：
//   一次能做多少，一律不封顶，这里填的是默认值，0 表示不限；
//   要花钱、要多跑几轮接口的，一律能改、能关。
//
// 这一页只放跟具体对象无关的旋钮。属于某个角色的（这个角色要不要主动找我、
// 多久找一次）按第 5 条留在角色自己的页面里，不往这儿搬。
// 召回打分那几项。标签是给人看的，键名和 ai/context/memory.js 的 WEIGHTS 对齐
const WEIGHT_KEYS = [
  ['cue', '线索'], ['recent', '新近'], ['strength', '强度'], ['weight', '分量'],
  ['open', '未了结'], ['slot', '时段'], ['manual', '手写'], ['first', '最早'],
  ['fatigue', '疲劳'],
];

export function LimitsPage() {
  const s = useStore(db.settings.store);
  const set = patch => db.settings.set(patch);
  // 现在开着哪几项会多打接口。清单只在 ai/cost.js 列一处
  const extra = ai.cost.active();
  // 重试与换套是相乘的。这个数从 ai/cost.js 来，界面不自己再算一遍
  const attempts = ai.cost.attemptsPerCall();

  // 权重当前值：用户改过的优先，没改过的显示内置那一份
  const fmtW = (cur, k) => {
    const w = { ...ai.memory.WEIGHTS, ...(cur.memoryWeights || {}) };
    return (Math.round(Number(w[k]) * 100) / 100).toString();
  };
  const tune = async (k, label) => {
    const cur = { ...ai.memory.WEIGHTS, ...(s.memoryWeights || {}) };
    const v = await prompt({
      title: `权重：${label}`, value: String(cur[k]),
      message: '数值越大，这一项对得分的影响越大。填 0 表示不参与计分。',
    });
    if (v === null) return;
    const n = Math.max(0, Number(v));
    if (!Number.isFinite(n)) { toast('请填写数字', 'error'); return; }
    set({ memoryWeights: { ...(s.memoryWeights || {}), [k]: n } });
  };

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
        <${ListItem} title="接口失败时自动换下一套" multiline
          subtitle=${s.chatFallback === true
            ? (ai.cost.swapCount() > 0
              ? `接口报错时按「主用、副用、其余」的顺序依次换，最多再换 ${ai.cost.swapCount()} 套。`
                + '失败的那几次同样计费。没填全密钥与模型的接口会跳过。'
              : '已开启，但目前只有一套填全了的接口，换不出去。在「接口」中再配一套后生效。')
            : '已关闭。接口报错时直接报错，不改用另一套重发。开启后失败的回合会多次计费。'}
          right=${html`<${Switch} checked=${s.chatFallback === true}
            onChange=${v => set({ chatFallback: v })}/>`}/>
        ${s.chatFallback === true ? html`
          <${ListItem} title="最多再换几套" multiline
            subtitle=${`失败之后最多依次试这么多套。填 0 表示把其余填全了的接口全部试一遍。`
              + `当前填全的共 ${ai.cost.usableChatCount()} 套。`}
            right=${html`<${NumberInput} value=${Number(s.failoverMax) || 0} min=${0}
              onChange=${v => set({ failoverMax: v })}/>`}/>` : null}
        <${ListItem} title="工具结果回来后角色接着回复" multiline
          subtitle=${s.mcpFollowUp === true
            ? '已开启。角色调用的 MCP 工具有了结果（包括失败与被拒绝）之后，再调用一次主用接口，'
              + '让角色读到结果后接着回复。'
            : '已关闭。工具结果留在对话中，角色在下一次回复时读到，不额外调用接口。'}
          right=${html`<${Switch} checked=${s.mcpFollowUp === true}
            onChange=${v => set({ mcpFollowUp: v })}/>`}/>
        ${s.mcpFollowUp === true ? html`
          <${ListItem} title="每条消息最多接着回复几次" multiline
            subtitle="从你发出一条消息算起，角色调用工具、读到结果、再调用，最多这么多轮。填 0 表示不限。"
            right=${html`<${NumberInput} value=${Number(s.mcpFollowMax) || 0} min=${0}
              onChange=${v => set({ mcpFollowMax: v })}/>`}/>` : null}
        <${ListItem} title="打完电话自动总结" multiline
          subtitle=${s.callSummary === false
            ? '已关闭。挂断后不生成总结，可在通话记录中手动生成。'
            : '每通接通过的电话挂断时，额外调用一次接口，把通话内容整理为一段总结，'
              + '显示在通话记录中。未接通的不生成。走副用接口。'}
          right=${html`<${Switch} checked=${s.callSummary !== false}
            onChange=${v => set({ callSummary: v })}/>`}/>
        <${ListItem} title="生图前先写一遍提示词" multiline
          subtitle=${s.writeImagePrompt !== true
            ? '已关闭。角色写的那一句会原样交给生图接口。'
            : '在生成之前额外调用一次接口，把角色写的那一句改写成完整的画面描述，'
              + '并把对话里才说得通的称呼换成具体的样子。每一张图多一次调用，走副用接口。'}
          right=${html`<${Switch} checked=${s.writeImagePrompt === true}
            onChange=${v => set({ writeImagePrompt: v })}/>`}/>
        <${ListItem} title="生成视频前先写一遍提示词" multiline
          subtitle=${s.writeVideoPrompt !== true
            ? '已关闭。角色写的那一句会原样交给视频接口。'
            : '在生成之前额外调用一次接口，把角色写的那一句改写成完整的画面与运动描述。'
              + '每一段视频多一次调用，走副用接口。'}
          right=${html`<${Switch} checked=${s.writeVideoPrompt === true}
            onChange=${v => set({ writeVideoPrompt: v })}/>`}/>
        <${ListItem} title="合成语音前先写成台本" multiline
          subtitle=${s.writeVoicePrompt !== true
            ? '已关闭。语音按原句合成，语气沿用角色卡与全局设置中填写的那一份。'
            : '语音消息在合成之前额外调用一次接口，在原句中标出停顿、情绪与叹气之类的声音，'
              + '原句的文字不作改动。每一条语音多一次调用，走副用接口。'
              + '通话中由通话模型随台词一并标出，不额外调用。'
              + '标注规则写在用途为「语音」的世界书中。'}
          right=${html`<${Switch} checked=${s.writeVoicePrompt === true}
            onChange=${v => set({ writeVoicePrompt: v })}/>`}/>
        <${ListItem} title="群聊中每个角色单独调用" multiline
          subtitle=${s.groupPerChar !== true
            ? '已关闭。群聊每轮调用一次接口，由模型一次写出所有开口成员的台词。'
              + '所有成员的角色卡在同一份提示词中，说话方式可能趋同。'
            : '群聊每轮按开口的成员各调用一次：有 @ 时为被 @ 的成员，没有时为全体成员。'
              + '每个成员只看自己的角色卡。群里有几人，每轮就最多多几次调用。'}
          right=${html`<${Switch} checked=${s.groupPerChar === true}
            onChange=${v => set({ groupPerChar: v })}/>`}/>
        <${ListItem} title="角色自己发视频" multiline
          subtitle=${s.videoOn !== true
            ? '已关闭。角色不会发视频，你仍可在会话面板中自己生成。'
            : '角色每写一个视频标记，额外调用一次视频接口生成一段。'
              + '按时长与分辨率计费，比生成图片贵得多，且需要一到五分钟。'
              + '未配置视频接口时不生效。'}
          right=${html`<${Switch} checked=${s.videoOn === true}
            onChange=${v => set({ videoOn: v })}/>`}/>
        <${ListItem} title="自动生成关系底色" multiline
          subtitle=${s.bondAuto !== true
            ? '已关闭。关系底色不会自动更新，可在会话菜单中手动生成或手写。'
            : '标记为 S 级的记忆有增删改时，额外调用一次接口，将其压缩为几句关系现状。'
              + '未发生变动时不调用。关闭后仍可手动生成。'}
          right=${html`<${Switch} checked=${s.bondAuto === true}
            onChange=${v => set({ bondAuto: v })}/>`}/>
        <${ListItem} title="线下一场收尾时生成摘要" multiline
          subtitle=${s.sceneSummary !== true
            ? '已关闭。线下的「收场」不会生成摘要，线上也读不到这一场发生了什么。'
            : '在线下点「收场」时，额外调用一次接口，把整场压成一段摘要，写入记忆并供线上读取。'
              + '每点一次调用一次，走副用或记忆接口。'}
          right=${html`<${Switch} checked=${s.sceneSummary === true}
            onChange=${v => set({ sceneSummary: v })}/>`}/>
        <${ListItem} title="线下把窗口外的段落压成摘要" multiline
          subtitle=${s.sceneCompress !== true
            ? '已关闭。超出「线下历史窗口」的段落直接不送，其内容不再进入上下文。'
            : '有段落被窗口挡在外面时，额外调用一次接口把它们压成摘要再挡掉，避免前情断裂。'
              + '「线下历史窗口」填 0 时不会触发。走副用或记忆接口。'}
          right=${html`<${Switch} checked=${s.sceneCompress === true}
            onChange=${v => set({ sceneCompress: v })}/>`}/>
        <${ListItem} title="缓存设定区那一段" multiline
          subtitle=${s.promptCache === false
            ? '已关闭。每一轮都按完整价格计算输入部分。'
            : '对话、通话与主动发起时，人设、世界书、消息规则这些整轮不变的内容声明为可缓存。'
              + '连续对话时重复命中，这一段按十分之一计价；'
              + '间隔过久未命中的那一次按一点二五倍计价。总结记忆、生成内容等一次性任务不声明。'
              + '仅 Anthropic 接口支持声明，其余接口由服务端自行处理，开关不影响。'}
          right=${html`<${Switch} checked=${s.promptCache !== false}
            onChange=${v => set({ promptCache: v })}/>`}/>
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

        <${Field} label="召回打分的权重"
          desc="决定一条记忆这一轮有多容易被想起。留空的项使用内置默认值。
            线索是与当前对话的关联，未了结是尚未兑现的约定，
            疲劳是刚注入过的条目本轮降权。改动后可在「记忆 - 上一轮召回」中查看效果。">
          <div class="chip-row">
            ${WEIGHT_KEYS.map(([k, label]) => html`
              <button key=${k} class="chip" onClick=${() => tune(k, label)}>
                ${label} ${fmtW(s, k)}
              </button>`)}
            <button class="chip" onClick=${() => set({ memoryWeights: {} })}>恢复默认</button>
          </div>
        <//>

        <${Field} label="通话每轮回复上限"
          desc="通话中模型每轮回复的 token 上限，每次请求都会用到。
            数值偏小时角色在电话里说一两句就停，接近日常通话的节奏；
            填 0 表示不限，改用接口本身的上限，回复可能变成大段独白。">
          <${NumberInput} value=${s.callMaxTokens} unit="token" placeholder="不限"
            onChange=${v => set({ callMaxTokens: v })}/>
        <//>

        <${Field} label="线下每段回复上限"
          desc="线下每段正文的 token 上限。
            填 0 表示不发送这一项，改用接口自身的上限，可以写出很长的一段。
            填写数值时请对照所用模型的输出上限：超出上限时接口会直接报错。">
          <${NumberInput} value=${s.sceneMaxTokens} unit="token" placeholder="不限"
            onChange=${v => set({ sceneMaxTokens: v })}/>
        <//>

        <${Field} label="线下注入预算"
          desc="线下每次请求中，世界书、记忆等注入内容的 token 预算（粗略估算）。
            线下一段正文动辄上千字，与线上共用一个数值必有一边不合适，因此分开设置。
            填 0 表示不限。">
          <${NumberInput} value=${s.sceneBudget} unit="token" placeholder="不限"
            onChange=${v => set({ sceneBudget: v })}/>
        <//>

        <${Field} label="线下历史窗口"
          desc="每次请求向前送多少段线下正文。填 0 表示全部送出。
            设置了数值之后，窗口之外的段落默认直接不送；
            需要保留其内容时，开启下方的「线下把窗口外的段落压成摘要」。
            钉住的段落不受此项限制。">
          <${NumberInput} value=${s.sceneWindow} unit="段" placeholder="全部"
            onChange=${v => set({ sceneWindow: v })}/>
        <//>

        <${Field} label="线下扫描窗口"
          desc="世界书与 B 级记忆按最近多少段线下正文扫描关键词。填 0 表示扫描整场。">
          <${NumberInput} value=${s.sceneScan} unit="段" placeholder="整场"
            onChange=${v => set({ sceneScan: v })}/>
        <//>

        <${Field} label="线下目标篇幅"
          desc="写入提示词的目标字数。填 0 表示不写，篇幅由角色卡与世界书决定。
            这是目标而非上限，实际长度仍由模型决定。">
          <${NumberInput} value=${s.sceneWords} unit="字" placeholder="不写"
            onChange=${v => set({ sceneWords: v })}/>
        <//>

        <${Field} label="带上几条「你记着的事」"
          desc="每次请求带上「待办」里已计入、还没做的这么多条，排好时间的在前。
            填 0 表示全部带上。角色要知道你几号去哪，靠的就是这一项。">
          <${NumberInput} value=${s.planCount} unit="条" placeholder="全部"
            onChange=${v => set({ planCount: v })}/>
        <//>

        <${Field} label="线下带上手机里最近几条"
          desc="线下的每次请求带上这段会话里最近这么多条消息的原文。
            气泡很短，二十条也只有几百字，所以带的是原文而不是摘要。
            填 0 表示不带，线下将完全看不到手机上刚说过的话。">
          <${NumberInput} value=${s.bridgeChatLines} unit="条" placeholder="不带"
            onChange=${v => set({ bridgeChatLines: v })}/>
        <//>

        <${Field} label="线上带上最近一次见面的多少字"
          desc="线上的每次请求带上最近一场线下的摘要，按这个字数截断。
            线下一段正文动辄上千字，带原文会顶掉上下文，所以这一侧只带摘要。
            没有摘要时截取最后一段，这一步不调用接口；需要真正的摘要请开启
            「线下一场收尾时生成摘要」。填 0 表示不带。">
          <${NumberInput} value=${s.bridgeSceneChars} unit="字" placeholder="不带"
            onChange=${v => set({ bridgeSceneChars: v })}/>
        <//>

        <${Field} label="工具结果给角色读多少字"
          desc="角色调用 MCP 工具拿到的结果，在之后每一轮请求中都会随那次调用一并发送，按这个字数截断。
            填 0 表示整段发送，结果较长时会明显增加每次请求的长度。">
          <${NumberInput} value=${s.mcpResultChars} unit="字" placeholder="整段"
            onChange=${v => set({ mcpResultChars: v })}/>
        <//>

        <${Field} label="分享歌曲时附上歌词"
          desc="在会话中分享一首歌、或评论带歌的动态时，角色读到的那一条后面附上这首歌的歌词。
            歌词取自曲库或网易云，不调用模型接口；但这条消息仍在上下文里的每一轮请求都会带着这段歌词。
            关闭后角色只看到歌名与歌手。">
          <${Switch} checked=${s.songLyric !== false} onChange=${v => set({ songLyric: v })}/>
        <//>

        <${Field} label="附上的歌词行数"
          desc="从第一句起附上这么多行。填 0 表示整首，一首歌通常四十行上下。">
          <${NumberInput} value=${s.songLyricLines} unit="行" placeholder="整首"
            onChange=${v => set({ songLyricLines: v })}/>
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
