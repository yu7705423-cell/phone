import { html, useState, useEffect, useRef } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Sheet, List, ListItem, Field, NumberInput, Button, Icon, Avatar,
         Spinner, toast } from '../../../ui/index.js';

const { db, book, para, ahead, ai } = phone;
const task = ai.readAhead;

// 让一个角色先往前读。它读完那一段，自己挑哪几段值得开口，留下段评；
// 你读到那儿才看见气泡。你追上它之后才弹窗问要不要继续。

/** 开始 / 换人 / 停下。也在这里改这一次注入多少字。 */
export function ReadAheadSheet({ open, bookId, from, onClose }) {
  useStore(db.ebooks.store);
  useStore(db.characters.store);
  useStore(db.settings.store);
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  const s = ahead.stateOf(bookId);
  const want = ahead.chars();

  const go = async charId => {
    if (busy) return;
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    setBusy(true);
    try {
      ahead.begin(bookId, charId, from);
      const r = await task.run({ bookId, charId, from });
      ahead.advance(bookId, r.to);
      toast(r.added ? `读了 ${r.read.toLocaleString()} 字，留下 ${r.added} 处`
        : `读了 ${r.read.toLocaleString()} 字，这一段没有想说的`, r.added ? 'ok' : 'plain', 4000);
      onClose();
    } catch (err) { toast(String(err.message || err), 'error', 6000); }
    finally { setBusy(false); }
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title="让角色先读" height="82%">
      <div class="pad-x">
        <div class="hint-box">
          把从当前位置起的一段正文交给角色读一遍。它会挑出想说的段落留下评论，
          你读到那些段落时才会看见。一次注入无论多少字都只调用一次接口。
        </div>
        <${Field} label="这一次注入多少字"
          desc="填 0 表示一次读到书末。此设置对以后每一次都生效。">
          <${NumberInput} value=${db.settings.get().injectChars} unit="字"
            placeholder="读到书末"
            onChange=${v => db.settings.set({ injectChars: v })}/>
        <//>
      </div>

      ${s ? html`
        <${List} title="正在先读">
          <${ListItem} title=${s.char.name} multiline
            subtitle=${`已读到 ${pctOf(bookId, s.at)}%`
              + (s.always ? ` · 已选择一直继续，最多再自动读 ${Math.max(0, ahead.maxRuns() - s.runs)} 次` : '')}
            left=${html`<${Avatar} src=${s.char.avatar} name=${s.char.name} size=${34}/>`}
            right=${html`<button class="nav-text press"
              onClick=${() => { ahead.stop(bookId); toast('已停下'); }}>停下</button>`}/>
        <//>` : null}

      <${List} title=${s ? '换一个角色' : '让谁来读'}>
        ${para.candidates().map(c => html`
          <${ListItem} key=${c.id} title=${phone.remark.nameOf(c)} arrow
            subtitle=${c.signature || ''}
            left=${html`<${Avatar} src=${c.avatar} name=${c.name} size=${34}/>`}
            right=${busy ? html`<${Spinner} size=${15}/>` : null}
            onClick=${() => go(c.id)}/>`)}
        ${para.candidates().length ? null : html`
          <${ListItem} title="还没有角色" multiline subtitle="先在「联系」里建一个角色"/>`}
      <//>

      <div class="settings-foot">
        当前设置为一次 ${want ? `${want.toLocaleString()} 字` : '读到书末'}。
        读完之后你追上它时会询问是否继续。
      </div>
    <//>`;
}

const pctOf = (bookId, at) => {
  const total = db.ebooks.get(bookId)?.chars || 0;
  return total ? Math.min(100, Math.round(at / total * 100)) : 0;
};

/**
 * 盯着你的进度。你追上它读到的位置时：
 * 选过「一直继续」且没到上限就悄悄再读一段，否则弹窗问一次。
 */
export function ReadAheadWatch({ bookId, at, span }) {
  useStore(db.ebooks.store);
  useStore(db.settings.store);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const snoozed = useRef(-1);
  const running = useRef(false);

  const s = ahead.stateOf(bookId);
  const due = !!s && ahead.caughtUp(bookId, at, span);
  const total = db.ebooks.get(bookId)?.chars || 0;
  const finished = !!s && s.at >= total && total > 0;

  const read = async (auto) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const r = await task.run({ bookId, charId: s.charId, from: s.at });
      ahead.advance(bookId, r.to, { auto });
      if (!auto) toast(r.added ? `又读了一段，留下 ${r.added} 处` : '又读了一段，没有想说的', 'ok');
    } catch (err) {
      // 自动续读失败一次就停下，改回每次先问。不停的话，重开这本书、来回翻页时
      // 又会自动再读一次，失败一次扣一次
      if (auto) ahead.setAlways(bookId, false);
      toast(`${String(err.message || err)}${auto ? '。已停止自动续读' : ''}`, 'error', 6000);
    }
    finally { running.current = false; setBusy(false); }
  };

  // 自动续读。到上限就不再自动，改成弹窗再问一次
  useEffect(() => {
    if (!due || finished || busy) return;
    if (ahead.canAuto(bookId)) { read(true); return; }
    if (snoozed.current === s.at) return;
    setAsking(true);
  }, [due, finished, s?.at, bookId]);

  if (!s) return null;

  const capped = ahead.hitCap(bookId);
  const line = finished
    ? `${s.char.name} 已经把这本书读完了`
    : `${s.char.name} 读到 ${pctOf(bookId, s.at)}%`;

  return html`
    <div class="ra-line">
      <${Icon} name="book" size=${12}/>
      <span>${line}</span>
      ${busy ? html`<${Spinner} size=${12}/>` : null}
    </div>

    <${Sheet} open=${asking} onClose=${() => { snoozed.current = s.at; setAsking(false); }}
      title=${`${s.char.name} 已经看完了`}>
      <div class="pad-x">
        <div class="hint-box">
          ${finished
            ? `${s.char.name} 已经读到这本书的结尾，没有更多可读的内容了。`
            : capped
              ? `已经连续自动读了 ${s.runs} 次，达到设定的上限。`
                + '继续将重新开始计数，每次读一段都会调用一次接口。'
              : `你已经读到 ${s.char.name} 读过的位置。`
                + '让 TA 继续往下读一段，会调用一次接口。'}
        </div>
        ${finished ? html`
          <div class="pad-b">
            <${Button} full variant="ghost"
              onClick=${() => { setAsking(false); ahead.stop(bookId); }}>知道了<//>
          </div>`
        : html`
          <div class="pad-b">
            <${Button} full disabled=${busy}
              onClick=${() => { setAsking(false); ahead.advance(bookId, s.at, { auto: false }); read(false); }}>
              继续读一段<//>
            <div class="pad-t">
              <${Button} full variant="ghost" disabled=${busy}
                onClick=${() => {
                  setAsking(false);
                  ahead.setAlways(bookId, true);
                  ahead.advance(bookId, s.at, { auto: false });
                  read(true);
                }}>一直继续，不再询问<//>
            </div>
            <div class="pad-t">
              <${Button} full variant="ghost"
                onClick=${() => { snoozed.current = s.at; setAsking(false); }}>先不用<//>
            </div>
          </div>
          <div class="settings-foot">
            选择「一直继续」后最多再自动读 ${ahead.maxRuns()} 次，达到上限会再次询问。
            次数上限在「一起看 - 设置」中调整。
          </div>`}
      </div>
    <//>`;
}
