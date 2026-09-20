import { chats } from '../../db/index.js';
import * as trip from '../../trip.js';
import * as currency from '../../currency.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask, runJSONWithPreset } from '../engine.js';
import { searchConfig, searchReady } from '../services.js';

// 找票。
//
// 两档，配了哪档走哪档 —— 和食谱那一套完全同构（见 tasks/recipe-batch.js）：
//
//   **会联网搜索的接口** 问得出真实的航班、车次、门票与演出，带真实价格，
//     而且带得回**场馆容量与想看人数**。这是它唯一值钱的地方。
//
//   **普通接口** 按目的地估一个常见价位。写出来是「东京往返大约多少钱」，
//     够用，但**不是真实票价**，界面上标成「估算」。
//
// ---- 只要客观数字，不要判断 ----
//
// 问的是：几张票、多少钱、场馆能坐多少人、多少人想看、分几档、哪一档
// 占多少票。**不问「抢到的概率是多少」** —— 那是算出来的，不是查出来的
// （第 16 条，也是随机事件那一条：点数不是模型的活）。
//
// 模型给一个「百分之十二」，给的是它的印象；38 万人抢 4.6 万张票，
// 算出来才是十二分之一。前者会随措辞漂移，后者不会。
//
// ---- 这不是订票系统 ----
//
// 搜回来的是模型看到的网页上的数字，可能过期、可能是区间。
// 存 `src` 与 `foundAt`，界面照实写。不接真实订票、不接支付。

const str = v => String(v ?? '').trim();
const int = v => Math.max(0, Math.round(Number(v) || 0));

export const canSearch = () => searchReady();

/** 这次出行该找哪几种票。界面拿它列选项。 */
export const kindsFor = row => (trip.KINDS_FOR[row?.kind] || trip.KINDS_FOR[trip.TRIP]);

// 场馆容量与想看人数**对哪一种票都问**，问不到就是 0。
// 原先按票种分两段问，模板里就出现了「When yes is yes」这种句子 ——
// 条件写进模板是错的，机票也有座位数，只是没有「多少人想看」这个数。
function varsOf(row, kind, n) {
  const k = trip.ticketKindOf(kind);
  const cur = currency.current();
  const when = [row.from, row.to].filter(Boolean).join(' 至 ') || '（日期未定）';
  return {
    kind: k.label,
    place: row.place || row.title,
    venue: row.venue || '',
    target: [row.title, row.venue].filter(Boolean).join(' '),
    when,
    count: n,
    currency: cur.code === 'none' ? 'CNY' : cur.code,
  };
}

/**
 * 找 n 条候选票。web 为真且配了联网接口，才走搜索那一档。
 *
 * **一次请求。** 不自动重试、不失败换一套（第 15 条）。
 */
export async function findTickets(tripId, { kind = trip.FLIGHT, count = 6, web = true } = {}) {
  const row = trip.get(tripId);
  if (!row) throw new Error('这次出行已经不在了');
  if (!chats.get(row.chatId)) throw new Error('这段对话已经不在了');
  const n = Math.max(1, Math.round(count) || 0);
  const useWeb = web && searchReady();
  if (web && !useWeb) throw new Error('尚未配置会联网搜索的接口');
  if (!row.place && !row.title) throw new Error('请先填写目的地');

  const vars = varsOf(row, kind, n);
  const opts = {
    system: fillTemplate(template(useWeb ? 'task.trip-tickets' : 'task.trip-tickets-guess'), vars),
    key: `trip-tickets:${tripId}:${kind}:${Date.now()}`,
    maxTokens: 500 + n * 120,
  };

  const out = useWeb
    ? await runJSONWithPreset(searchConfig(), opts)
    : await runJSONTask('trip.tickets', opts);

  const rows = (Array.isArray(out?.tickets) ? out.tickets : []).map(t => ({
    kind,
    title: str(t?.title),
    from: str(t?.from),
    to: str(t?.to),
    at: str(t?.at),
    seat: str(t?.seat),
    face: Math.max(0, Number(t?.face) || 0),
    qty: 2,
    // 抢票要用的那几个客观数字。搜不到就是 0，第三批据此当成「不需要抢」
    capacity: int(t?.capacity),
    demand: int(t?.demand),
    share: Number(t?.share) || 0,
    heat: Number(t?.heat) || 0,
    saleAt: str(t?.saleAt),
    need: trip.ticketKindOf(kind).grab,
    note: str(t?.note),
  })).filter(t => t.title && t.face > 0);

  if (!rows.length) throw new Error('这一次没有找到票，可以再试一次');
  return trip.addTickets(tripId, rows, useWeb ? trip.SEARCHED : trip.GUESSED);
}
