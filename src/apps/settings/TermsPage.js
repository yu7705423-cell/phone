import { html } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Page } from '../../ui/index.js';

const { nav, terms } = phone;

// 使用须知与内测说明，随时重看（第一次打开时的确认见 shell/TermsGate.js）。只读
export function TermsPage() {
  const { NOTICE, BETA, TITLE } = terms;
  return html`
    <${Page} title=${TITLE} onBack=${nav.pop}>
      <div class="terms-body">
        <p class="terms-p">${NOTICE.intro}</p>
        ${NOTICE.sections.map(s => html`
          <div class="terms-sec" key=${s.title}>
            <div class="terms-sec-title">${s.title}</div>
            ${s.body.map((p, i) => html`<p class="terms-p" key=${i}>${p}</p>`)}
          </div>`)}
        <p class="terms-p terms-outro">${NOTICE.outro}</p>
        <div class="terms-sec">
          <div class="terms-sec-title">${BETA.title}</div>
          <p class="terms-p">${BETA.intro}</p>
          ${BETA.items.map((t, i) => html`<p class="terms-p" key=${i}>${i + 1}. ${t}</p>`)}
        </div>
      </div>
    <//>`;
}
