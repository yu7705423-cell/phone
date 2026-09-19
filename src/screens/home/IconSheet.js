import { html } from '../../lib.js';
import { IconPicker } from '../../ui/index.js';
import { useStore } from '../../system/store.js';
import { settings } from '../../system/db/index.js';
import { useImage } from '../../system/db/useImage.js';
import { ICON_MAX } from '../../system/db/images.js';
import { appLook, iconOverride, setAppIcon, resetAppIcon,
         setAppIconFile, setAppIconUrl, clearAppIconImage } from '../../system/look.js';

const service = {
  override: iconOverride,
  set: setAppIcon,
  reset: resetAppIcon,
  file: setAppIconFile,
  url: setAppIconUrl,
  clearImage: clearAppIconImage,
};

// 主界面与文件夹里长按图标弹的就是它。设置 - 外观那一处用的是同一个组件。
export function IconSheet({ appId, onClose }) {
  useStore(settings.store);
  const preview = useImage(appId ? iconOverride(appId).imageId : null);
  if (!appId) return null;
  return html`<${IconPicker} appId=${appId} app=${appLook(appId)} preview=${preview}
    service=${service} maxEdge=${ICON_MAX} onClose=${onClose}/>`;
}
