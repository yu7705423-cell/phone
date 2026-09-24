import { useState, useEffect } from '../../lib.js';
import { files } from './files.js';
import { useBlobEpoch } from './useImage.js';

// 地址失效后跟着重取，理由同 useImage
export function useFile(id) {
  const epoch = useBlobEpoch();
  const [url, setUrl] = useState(() => files.peek(id));
  useEffect(() => {
    let alive = true;
    if (!id) { setUrl(null); return; }
    const cached = files.peek(id);
    if (cached) { setUrl(cached); return; }
    files.url(id).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id, epoch]);
  return url;
}
