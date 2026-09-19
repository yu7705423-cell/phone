// SSE 行读取。两家 provider 的流都走这里
export async function* sseLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
    if (buf.startsWith('data:')) yield buf.slice(5).trim();
  } finally {
    reader.cancel().catch(() => {});
  }
}

// 一段没写完的 JSON 里，切到哪里为止前面是完整的。
// 逗号之前、以及每个闭合括号之后，都是可以下刀的地方。
function cutPoints(text) {
  const out = [];
  const stack = [];
  let inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[') { stack.push(c); continue; }
    if (c === '}' || c === ']') { stack.pop(); if (stack.length) out.push(i + 1); continue; }
    if (c === ',' && stack.length) out.push(i);
  }
  return out;
}

// 从这一段开头数，还欠哪几个收尾括号。字符串没闭合就返回 null。
function closersFor(text) {
  const stack = [];
  let inStr = false, esc = false;
  for (const c of text) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  return inStr ? null : stack.reverse().join('');
}

/**
 * 输出被 max_tokens 截断的那种残缺 JSON，把最后那条没写完的丢掉，
 * 补上收尾括号，把前面已经写完的救回来。
 *
 * **这不是再调一次接口**（第 15 条）—— 截断的响应已经付过钱了，
 * 整段丢掉等于白付。救回来的是模型确实写完的那几条，一条不多。
 */
export function salvageJSON(text) {
  const points = cutPoints(text);
  // 从最靠后的下刀点往前试，能救多少救多少
  for (let k = points.length - 1, tried = 0; k >= 0 && tried < 40; k--, tried++) {
    const head = text.slice(0, points[k]).replace(/,\s*$/, '');
    const tail = closersFor(head);
    if (tail === null) continue;
    try { return JSON.parse(head + tail); } catch { /* 再往前一个点 */ }
  }
  return null;
}

// 模型输出的 JSON 往往裹在解释文字里。
// 先整体 parse,失败再扫描第一个括号平衡的对象。不要用贪婪正则。
// 都不成再当成截断的来救 —— 那一份已经付过钱了。
export function parseJSON(raw) {
  const text = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(text); } catch {}

  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const openCh = text[start];
  const closeCh = openCh === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); }
        catch { return salvageJSON(text.slice(start)); }
      }
    }
  }
  // 走到头都没闭合，就是被截断了
  return salvageJSON(text.slice(start));
}
