import { useState, useEffect } from '../../lib.js';
import { images } from './images.js';

// 图片 id -> objectURL。组件卸载时不 revoke(URL 由 images 缓存复用),
// 整页卸载统一回收,避免同一张图被多处引用时提前失效。
export function useImage(id) {
  const [url, setUrl] = useState(() => images.peek(id));
  useEffect(() => {
    let alive = true;
    if (!id) { setUrl(null); return; }
    const cached = images.peek(id);
    if (cached) { setUrl(cached); return; }
    images.url(id).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id]);
  return url;
}
