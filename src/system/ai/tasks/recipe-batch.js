import * as food from '../../food.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask, runJSONWithPreset } from '../engine.js';
import { searchConfig, searchReady } from '../services.js';
import { cancel } from '../queue.js';

// 生成食谱库。
//
// 两档，配了哪档走哪档 —— 和识图、语音那几处是同一个套路：
//
//   **普通接口** 按地区写常见的家常菜、早点、外卖。模型凭它知道的写，
//     写出来的是「这个地方的人平时吃什么」，够用，也不会出错到离谱。
//
//   **会联网搜索的接口** 才问得出「这个地方真的有哪几家店」。
//     这一档写出来的条目带店名，上下文里就成了「午饭在陈记面馆吃的担担面」。
//     这是它唯一值钱的地方，也是唯一需要多花一份钱的地方。
//
// 两档都是**单独的调用**，和聊天无关。生成结果先摆出来看一眼再入库。

const str = v => String(v ?? '').trim();

export const recipeKey = region => `recipe-batch:${region || 'common'}`;
export const cancelBatch = region => cancel(recipeKey(region));

export const canSearch = () => searchReady();

/**
 * 生成一批。region 留空就是「哪儿都有的那些」。
 * web 为真且配了联网接口，才走搜索那一档。
 */
export async function generate({ region = '', meal = '', count = 20, web = false } = {}) {
  const n = Math.max(1, Math.round(count) || 0);
  const m = food.mealOf(meal);
  const useWeb = web && searchReady();
  if (web && !useWeb) throw new Error('尚未配置会联网搜索的接口');
  if (useWeb && !region) throw new Error('联网搜索需要先填写地区');

  const vars = {
    region: region || '',
    regionLine: region ? `地区：${region}` : '不限地区，写哪儿都吃得到的那些',
    meal: m ? m.label : '不限',
    count: n,
    existing: food.list({ region }).map(r => `- ${r.name}`).join('\n') || '（这一批还是空的）',
  };

  const system = fillTemplate(template(useWeb ? 'task.recipe-search' : 'task.recipe-batch'), vars);
  const opts = { system, key: recipeKey(region), maxTokens: 400 + n * 60 };

  const out = useWeb
    ? await runJSONWithPreset(searchConfig(), opts)
    : await runJSONTask('recipe.batch', opts);

  const rows = Array.isArray(out?.dishes) ? out.dishes : [];
  const seen = new Set();
  return rows
    .map(x => (typeof x === 'string'
      ? { name: str(x) }
      : { name: str(x?.name), note: str(x?.note), place: useWeb ? str(x?.place) : '' }))
    .filter(r => {
      const key = food.normalize(r.name);
      if (!key || seen.has(key)) return false;
      if (food.has(r.name, region)) return false;
      seen.add(key);
      return true;
    })
    .map(r => ({ ...r, region, meal: m ? m.id : '' }));
}
