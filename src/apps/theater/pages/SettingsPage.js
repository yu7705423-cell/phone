import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, Field, NumberInput } from '../../../ui/index.js';

const { db, nav } = phone;

// 一起看与一起读的旋钮。放在这个 app 里，不放「设置 - 用量与上限」——
// 用户要改它们的时候，人正在这儿（第 5 条）。用量与上限那一页留一行指路。
export function SettingsPage() {
  const s = useStore(db.settings.store);
  const set = patch => db.settings.set(patch);

  return html`
    <${Page} title="一起看与一起读" onBack=${nav.pop}>
      <div class="list-title">一起看</div>
      <div class="pad-x">
        <${Field} label="她自行开口的最短间隔"
          desc="一起看时，角色自行开口至少相隔这个时长，每次开口调用一次模型接口。
            填 0 表示不主动开口，只在你说话时回应。">
          <${NumberInput} value=${s.watchGap} unit="秒" placeholder="只在你说话时回应"
            onChange=${v => set({ watchGap: v })}/>
        <//>
        <${Field} label="每次给她看几句台词"
          desc="从当前进度往前取这么多句字幕写入上下文。给得多则她接得上前情，
            但每轮的上下文也更长。">
          <${NumberInput} value=${s.watchLines} unit="条" placeholder="8"
            onChange=${v => set({ watchLines: v })}/>
        <//>
      </div>

      <div class="list-title">一起读</div>
      <div class="pad-x">
        <${Field} label="她自行开口的最短间隔"
          desc="一起读时，翻过这么多页角色才会自行开口一次，每次开口调用一次模型接口。
            填 0 表示不主动开口，只在你点「让她说一句」时才说。">
          <${NumberInput} value=${s.readGap ?? 1} unit="页" placeholder="只在你点的时候"
            onChange=${v => set({ readGap: v })}/>
        <//>
        <${Field} label="每次给她看这一页的多少字"
          desc="把你正读的这一页截取这么多字写入上下文。填 0 表示不给正文，
            她只知道书名、章节与进度。给得多则她说得贴切，但每轮的上下文也更长。">
          <${NumberInput} value=${s.readChars ?? 900} unit="字" placeholder="不给正文"
            onChange=${v => set({ readChars: v })}/>
        <//>
      </div>

      <div class="list-title">两者共用</div>
      <div class="pad-x pad-b">
        <${Field} label="离开之后多久收场"
          desc="从播放页或阅读页退出后，该场不会立即结束，以便中途处理别的事。
            超过这个时长未回来则自动收场，并在会话中留下记录。填 0 表示一直保留。">
          <${NumberInput} value=${s.watchAwayEnd} unit="分钟" placeholder="一直保留"
            onChange=${v => set({ watchAwayEnd: v })}/>
        <//>
      </div>
    <//>`;
}
