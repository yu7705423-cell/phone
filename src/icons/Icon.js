import { html } from '../lib.js';
import { PATHS } from './paths.js';

const missing = new Set();

export function Icon({ name, size = 22, stroke = 1.5, fill = 'none', class: cls = '', style = '' }) {
  const d = PATHS[name];
  if (!d) {
    if (!missing.has(name)) { missing.add(name); console.warn('[icon] 未注册的图标:', name); }
    return html`<svg width=${size} height=${size} viewBox="0 0 24 24"
      class=${cls} style=${style} aria-hidden="true"
    ><rect x="3" y="3" width="18" height="18" rx="4" fill="none"
        stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/></svg>`;
  }
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24"
    fill=${fill} stroke="currentColor" stroke-width=${stroke}
    stroke-linecap="round" stroke-linejoin="round"
    class=${cls} style=${style} aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: d }}></svg>`;
}
