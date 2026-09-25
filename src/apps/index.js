// 唯一一处列出所有 app。新增 app = 新建目录 + 在这里加一行。
import { registerApp } from '../system/registry.js';

import { manifest as chat } from './chat/manifest.js';
import { manifest as contact } from './contact/manifest.js';
import { manifest as lorebook } from './lorebook/manifest.js';
import { manifest as memory } from './memory/manifest.js';
import { manifest as space } from './space/manifest.js';
import { manifest as daily } from './daily/manifest.js';
import { manifest as todoApp } from './todo/manifest.js';
import { manifest as music } from './music/manifest.js';
import { manifest as bill } from './bill/manifest.js';
import { manifest as theater } from './theater/manifest.js';
import { manifest as healthApp } from './health/manifest.js';
import { manifest as albumApp } from './album/manifest.js';
import { manifest as travelApp } from './travel/manifest.js';
import { manifest as theirsApp } from './theirs/manifest.js';
import { manifest as usApp } from './us/manifest.js';
import { manifest as skinApp } from './skin/manifest.js';
import { manifest as mcpApp } from './mcp/manifest.js';
import { manifest as closetApp } from './closet/manifest.js';
import { manifest as settingsApp } from './settings/manifest.js';

export function registerApps() {
  [chat, contact, lorebook, memory, space, daily, todoApp, music, bill, theater,
    healthApp, albumApp, travelApp, theirsApp, usApp, skinApp, closetApp, mcpApp, settingsApp].forEach(registerApp);
}
