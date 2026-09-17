// 唯一一处列出所有 app。新增 app = 新建目录 + 在这里加一行。
import { registerApp } from '../system/registry.js';

import { manifest as chat } from './chat/manifest.js';
import { manifest as contact } from './contact/manifest.js';
import { manifest as lorebook } from './lorebook/manifest.js';
import { manifest as memory } from './memory/manifest.js';
import { manifest as space } from './space/manifest.js';
import { manifest as daily } from './daily/manifest.js';
import { manifest as settingsApp } from './settings/manifest.js';
import { stubManifests } from './stub/manifests.js';

export function registerApps() {
  [chat, contact, lorebook, memory, space, daily, settingsApp, ...stubManifests].forEach(registerApp);
}
