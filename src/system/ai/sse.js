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

// 模型输出的 JSON 往往裹在解释文字里。
// 先整体 parse,失败再扫描第一个括号平衡的对象。不要用贪婪正则。
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
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}
