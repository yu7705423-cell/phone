import { useState, useEffect } from '../../lib.js';
import { files } from './files.js';

export function useFile(id) {
  const [url, setUrl] = useState(() => files.peek(id));
  useEffect(() => {
    let alive = true;
    if (!id) { setUrl(null); return; }
    const cached = files.peek(id);
    if (cached) { setUrl(cached); return; }
    files.url(id).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id]);
  return url;
}
