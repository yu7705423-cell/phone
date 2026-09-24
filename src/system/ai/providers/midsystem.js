/**
 * 对话历史**中间**的那几条 system 消息，改成 user 轮、用 <context> 包住。
 *
 * 世界书里设了深度的条目、本轮召回的记忆、时间与状态这些每轮都变的内容，
 * 都是以 system 角色插进历史的（见 engine.insertLore）。
 *
 *   Anthropic        messages 只认 user 与 assistant，原样发过去就是 400
 *   OpenAI 兼容中转   多数照收不报错，但转给 Claude、Gemini 时各有各的处理：
 *                    丢掉、只留第一条、挪到最前面 —— 请求记录里明明有，模型却没看见
 *
 * 转成 user 各家都认。用 <context> 包住，免得它读起来像用户自己说的话、
 * 模型回一句「好的我记住了」（Anthropic 自己文档里就是这样放资料的）。
 *
 * 转完合并相邻的同角色消息 —— 有的接口不收连续两条同角色的。带图的那条不合，合进去图就和文字错位了。
 */
export function asUserTurns(messages) {
  const out = [];
  for (const m of messages || []) {
    const one = m.role === 'system'
      ? { ...m, role: 'user', content: `<context>\n${m.content}\n</context>` }
      : m;
    const last = out[out.length - 1];
    if (last && last.role === one.role && !last.image && !one.image) {
      last.content += `\n\n${one.content}`;
    } else {
      out.push({ ...one });
    }
  }
  return out;
}
