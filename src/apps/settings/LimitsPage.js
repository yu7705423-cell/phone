import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, Field, NumberInput } from '../../ui/index.js';

const { db, nav } = phone;

// 用量与上限。见 CLAUDE.md 第 13 条：
//   一次能做多少，一律不封顶，这里填的是默认值，0 表示不限；
//   要花钱、要多跑几轮接口的，一律能改、能关。
//
// 这一页只放跟具体对象无关的旋钮。属于某个角色的（这个角色要不要主动找我、
// 多久找一次）按第 5 条留在角色自己的页面里，不往这儿搬。
export function LimitsPage() {
  const s = useStore(db.settings.store);
  const set = patch => db.settings.set(patch);

  return html`
    <${Page} title="用量与上限" onBack=${nav.pop}>
      <div class="settings-foot">
        以下数值均填 0 表示不限。这里给出的是默认值，不是硬性上限，可按需要调大。
        标注了「每次请求」的项目直接影响接口费用。
      </div>

      <div class="list-title">发给模型的内容</div>
      <div class="pad-x pad-b">
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

      <div class="settings-foot">
        历史范围、注入预算、记忆条数在会话右上角的「上下文」中设置。
        某个角色是否主动发起对话、间隔多久，在该角色的会话菜单中设置。
      </div>
    <//>`;
}
