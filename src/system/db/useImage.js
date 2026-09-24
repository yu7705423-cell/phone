import { useState, useEffect } from '../../lib.js';
import { images } from './images.js';
import { blobEpoch, onBlobReset } from './blobs.js';

// 图片 id -> objectURL。组件卸载时不 revoke(URL 由 images 缓存复用),
// 整页卸载时浏览器自己回收，避免同一张图被多处引用时提前失效。
//
// 地址会失效（iOS 放在后台久了会收走 blob 背后的数据，见 blobs.js）。
// 失效后缓存整体换新，这里跟着第几代重新取一次；新地址到手之前先留着旧的，不闪一下空白。
export function useBlobEpoch() {
  const [epoch, setEpoch] = useState(blobEpoch);
  useEffect(() => onBlobReset(setEpoch), []);
  return epoch;
}

export function useImage(id) {
  const epoch = useBlobEpoch();
  const [url, setUrl] = useState(() => images.peek(id));
  useEffect(() => {
    let alive = true;
    if (!id) { setUrl(null); return; }
    const cached = images.peek(id);
    if (cached) { setUrl(cached); return; }
    images.url(id).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id, epoch]);
  return url;
}

// 缩略图那一份。列表、九宫格、气泡里的图一律用它。
// 没有缩略图（图本来就小）时退回原图，调用方不分情况。
export function useThumb(id) {
  const epoch = useBlobEpoch();
  const [url, setUrl] = useState(() => images.peekThumb(id));
  useEffect(() => {
    let alive = true;
    if (!id) { setUrl(null); return; }
    const cached = images.peekThumb(id);
    if (cached) { setUrl(cached); return; }
    images.thumbUrl(id).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id, epoch]);
  return url;
}
