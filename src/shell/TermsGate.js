import { html, useState, useEffect } from '../lib.js';
import { useStore } from '../system/store.js';
import { Button } from '../ui/index.js';
import { NOTICE, TITLE, BETA, termsStore, accept, decline, restart } from '../system/terms.js';

// 使用须知与内测说明（system/terms.js，ARCHITECTURE 4.246）。
//
// 第 0 步是使用须知全文；第 1 到 6 步是内测说明，一条一页。每一步「同意 / 不同意」，
// 不同意就结束（安卓安装包里关掉应用，别处画结束页）。全部同意才放行，之后不再弹。
//
// 每一页要读够时间「同意」才能点（用户要求）：使用须知 5 秒，内测说明每条 3 秒。按钮上倒数。
// 「不同意」随时能点。
const READ_FIRST = 5;
const READ_EACH = 3;

export function TermsGate() {
  const t = useStore(termsStore);
  const [step, setStep] = useState(0);
  const [wait, setWait] = useState(READ_FIRST);
  const total = BETA.items.length;

  // 每换一页重新计时。结束页上停着不计
  useEffect(() => {
    if (t.declined) return undefined;
    setWait(step === 0 ? READ_FIRST : READ_EACH);
    const id = setInterval(() => setWait(w => (w > 1 ? w - 1 : (clearInterval(id), 0))), 1000);
    return () => clearInterval(id);
  }, [step, t.declined]);

  if (t.declined) {
    return html`
      <div class="terms-gate is-end">
        <div class="terms-end">
          <div class="terms-end-text">你未同意${step === 0 ? '使用须知' : '内测说明'}，无法使用 Eira。</div>
          <${Button} variant="ghost" onClick=${() => { setStep(0); restart(); }}>重新阅读<//>
        </div>
      </div>`;
  }

  const next = () => (step < total ? setStep(step + 1) : accept());

  return html`
    <div class="terms-gate">
      <div class="terms-body scroll" key=${step}>
        ${step === 0 ? html`
          <div class="terms-title">${TITLE}</div>
          <p class="terms-p">${NOTICE.intro}</p>
          ${NOTICE.sections.map(s => html`
            <div class="terms-sec" key=${s.title}>
              <div class="terms-sec-title">${s.title}</div>
              ${s.body.map((p, i) => html`<p class="terms-p" key=${i}>${p}</p>`)}
            </div>`)}
          <p class="terms-p terms-outro">${NOTICE.outro}</p>`
        : html`
          <div class="terms-title">${BETA.title}</div>
          <div class="terms-step">第 ${step} / ${total} 条</div>
          <p class="terms-p">${BETA.intro}</p>
          <div class="terms-item">${step}. ${BETA.items[step - 1]}</div>`}
      </div>
      <div class="terms-acts">
        <${Button} variant="ghost" onClick=${decline}>不同意<//>
        <${Button} onClick=${next} disabled=${wait > 0}>${wait > 0 ? `同意（${wait}）` : '同意'}<//>
      </div>
    </div>`;
}
