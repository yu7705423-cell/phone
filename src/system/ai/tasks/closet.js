// 衣帽间里要调接口的那两样：识图、按描述生图。**都是用户点了才调**，一件一次，
// 按钮上写着要调几次（第 13、15 条）。见 ARCHITECTURE 4.213
import { closet } from '../../db/index.js';
import { template, fillTemplate } from '../templates.js';
import { ask, isVisionReady } from '../vision.js';
import { parseJSON } from '../sse.js';
import { generate, isImageReady } from '../image.js';
import { images } from '../../db/images.js';
import { toDataUrl } from '../../audio.js';
import { subsOf, setImage } from '../../closet.js';
import { GROUPS, COLORS, SEASONS, OCCASIONS, groupOf } from '../../closet-kinds.js';

export { isVisionReady, isImageReady };

// 分类表摆给识图模型看。名字是数据，原样给
const groupLines = () => GROUPS.map(g =>
  `${g.id}: ${g.label} — ${subsOf(g.id).map(s => s.label).join(' / ')}`).join('\n');
const idList = list => list.map(x => `${x.id} (${x.label})`).join(', ');

const pick = (ids, list) => (Array.isArray(ids) ? ids : [])
  .map(String).filter(id => list.some(x => x.id === id));

/**
 * 看一件东西的照片，填上分类、颜色、季节、场合、名字与描述。
 * **只填空着的**：用户自己写过的名字、描述、选过的分类不动
 */
export async function recognize(id) {
  const row = closet.get(id);
  if (!row) throw new Error('这件东西已经不在了');
  if (!row.imageId) throw new Error('这件东西还没有图片');
  if (!isVisionReady()) throw new Error('尚未配置识图接口，可在「设置 - 识图」中填写');
  const blob = await images.blob(row.imageId);
  if (!blob) throw new Error('图片已不存在');
  const prompt = fillTemplate(template('task.closet-vision'), {
    groups: groupLines(), colors: idList(COLORS), seasons: idList(SEASONS), occasions: idList(OCCASIONS),
  });
  const raw = await ask({ dataUrl: await toDataUrl(blob), prompt, key: `closet-vision:${id}`, maxTokens: 500 });
  const j = parseJSON(raw);
  if (!j) throw new Error('识图接口返回的内容读不出来');

  const g = groupOf(String(j.group || ''));
  const cur = closet.get(id) || row;
  const patch = {};
  if (!cur.group && g) {
    patch.group = g.id;
    patch.side = g.side;
    const sub = subsOf(g.id).find(s => s.label === String(j.sub || '').trim());
    if (sub) patch.sub = sub.label;
  }
  const name = String(j.name || '').trim().slice(0, 40);
  if (name && (!cur.name || cur.name === '未命名')) patch.name = name;
  const desc = String(j.desc || '').trim();
  if (desc && !cur.desc) patch.desc = desc.slice(0, 300);
  if (!(cur.colors || []).length) patch.colors = pick(j.colors, COLORS);
  if (!(cur.seasons || []).length) patch.seasons = pick(j.seasons, SEASONS);
  if (!(cur.occasions || []).length) patch.occasions = pick(j.occasions, OCCASIONS);
  const shade = String(j.shade || '').trim();
  if (shade && !cur.shade) patch.shade = shade.slice(0, 30);
  // 改分类要走 closet.update，妆台那几样默认值跟着换 —— 这里直接写，省一层 import 成环
  return closet.update(id, patch);
}

/** 一件一件识。一件失败不拦后面的；每识完一件回调一次，界面好一条一条亮 */
export async function recognizeMany(ids, onEach) {
  const failed = [];
  let done = 0;
  for (const id of ids) {
    try { await recognize(id); done += 1; }
    catch (err) { failed.push({ id, error: String(err.message || err) }); }
    onEach?.({ done, failed: failed.length, total: ids.length });
  }
  return { done, failed };
}

/** 按描述画一张。没有描述就拿名字和小类凑一句 */
export async function draw(id) {
  const row = closet.get(id);
  if (!row) throw new Error('这件东西已经不在了');
  if (!isImageReady()) throw new Error('尚未配置生图接口，可在「设置 - 生图」中填写');
  const what = String(row.desc || '').trim()
    || [row.name, row.sub, row.shade].filter(Boolean).join(', ');
  if (!what) throw new Error('先写一句描述再生成');
  const prompt = fillTemplate(template('task.closet-image'), { desc: what });
  const blob = await generate({ prompt, key: `closet-img:${id}` });
  await setImage(id, new File([blob], 'item.png', { type: blob.type || 'image/png' }));
  return closet.get(id);
}
