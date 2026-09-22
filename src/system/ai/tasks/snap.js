import { characters } from '../../db/index.js';
import * as imageSvc from '../image.js';
import * as imgPrompt from '../imageprompt.js';
import { template, runJSONTask } from '../engine.js';
import { fillTemplate } from '../templates.js';
import { notify } from '../../notify.js';
import * as extras from '../../extras.js';
import * as album from '../../album.js';
import { listFor } from '../context/memory.js';

// 角色自己往相册里存照片。
//
// **本来是反过来的：人点进相册，按一下「生成」，然后看着它画。** 那样没有
// 任何意外可言 —— 你已经知道会多出一张，也知道大概是什么时候。相册里那些
// 照片的意思恰恰在于「你没在场的时候她拍了一张」，所以这件事必须由角色自己
// 挑时候做，人只能事后翻到。
//
// 节奏跟着深夜那一档的办法：**按天算，而且距上次要够久**。定成每小时一张，
// 它就从「她今天拍了张照片」变成一个固定产出，和签到没区别。
//
// 一次两个接口调用（想拍什么、以及真的画出来），所以默认关着，
// 登记在 ai/cost.js 的 EXTRA_CALLS 里（CLAUDE.md 第 15 条）。

export const DEFAULTS = {
  snap: false,      // 总开关，默认关
  snapDays: 2,      // 距上次至少隔这么多天。填 0 表示不限
};

const KEY = 'phone.snap.at';

const numOr = (v, fallback) => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
};

export function configOf(char) {
  if (!char) return { ...DEFAULTS };
  return {
    snap: char.snap === true,
    snapDays: numOr(char.snapDays, DEFAULTS.snapDays),
  };
}

// 上次是什么时候存的。设备本地的临时状态，和主动消息那一套一样不进 IndexedDB
function readMap() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
export const lastAt = charId => readMap()[charId] || 0;
export function setLastAt(charId, t) {
  const m = readMap();
  if (t) m[charId] = t; else delete m[charId];
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* 隐私模式会抛 */ }
}

/** 这个角色现在该不该存一张。开着、生图配好了、距上次够久，三样都要。 */
export function due(char, now = Date.now()) {
  const cfg = configOf(char);
  if (!cfg.snap) return false;
  if (!imageSvc.isImageReady()) return false;
  const gap = cfg.snapDays * 86400000;
  return now - lastAt(char.id) >= gap;
}

function charContext(char) {
  const mems = listFor(char.id)
    .filter(m => m.rank === 'S' || m.rank === 'A')
    .slice(0, 10)
    .map(m => `- ${m.content}`).join('\n');
  return [char.persona, mems ? `What you remember lately:\n${mems}` : ''].filter(Boolean).join('\n\n');
}

/**
 * 存一张。回这一张的 photo 行；没存成回 null。
 *
 * **不抛。** 这是背景里自己发生的事，没人在等它 —— 抛出去只会在控制台留
 * 一行没人看的红字，而该做的是安静地不发生。
 */
export async function takeSnap(charId) {
  const char = characters.get(charId);
  if (!char) return null;
  if (!imageSvc.isImageReady()) return null;

  const system = fillTemplate(template('task.snap'), {
    charName: char.name || '',
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
  }) + `\n\n## Your own settings\n${charContext(char)}`;

  const r = await runJSONTask('char.snap', { system, key: `snap:${charId}`, maxTokens: 400 });
  const prompt = String(r?.imagePrompt || '').trim();
  if (!prompt || prompt === 'null') return null;

  const blob = await imageSvc.generate({
    prompt: imgPrompt.compose({ prompt, char }),
    key: `snap-img:${charId}:${Date.now()}`,
  });
  const imageId = await imageSvc.toLibrary(blob);

  const photo = album.saveImage({
    imageId,
    // 相册里那一行「来自」要写清楚是谁、什么时候 —— 不然翻到时不知道哪来的
    from: { name: char.name || '', at: Date.now(), charId },
    note: String(r?.note || '').trim().slice(0, 200),
  });

  // 弹不弹跟着朋友圈那一条的规矩：只有特别关心的才弹。
  // 相册本来就是「你想起来才去看」的东西，每张都弹就成了骚扰
  if (extras.isStarred(char)) {
    notify({
      title: extras.starTitle(char, char.name || '新照片'),
      body: photo.note || '存了一张照片',
      icon: 'image', appId: 'album', avatar: char.avatar,
      payload: { route: '/' },
    });
  }
  return photo;
}

/** 删角色时把它的落点一并清掉，不然那条记号永远留着。 */
export const forget = charId => setLastAt(charId, 0);
