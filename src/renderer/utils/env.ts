import { isTauriEnvironment } from './browserMock';

export const isTauri = isTauriEnvironment;

/** 在 Tauri 环境下拖动窗口，调用于 onMouseDown 事件 */
export const startWindowDrag = async (e: React.MouseEvent) => {
  if (e.button !== 0) return;
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  getCurrentWindow().startDragging().catch(console.error);
};

/** 双击标题栏切换最大化/还原 */
export const toggleMaximize = async () => {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  const maximized = await win.isMaximized();
  if (maximized) {
    win.unmaximize().catch(console.error);
  } else {
    win.maximize().catch(console.error);
  }
};
