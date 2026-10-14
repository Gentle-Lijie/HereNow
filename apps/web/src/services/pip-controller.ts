export interface DocumentPipApi {
  requestWindow(options: {
    width: number;
    height: number;
    disallowReturnToOpener: boolean;
  }): Promise<Window>;
}
interface PipDependencies {
  secure: () => boolean;
  api: () => DocumentPipApi | undefined;
  authorize: (eventId: string) => Promise<void>;
  loadRenderer: () => Promise<(target: Window, eventId: string) => () => void>;
}
export function createPipController(deps: PipDependencies) {
  let revision = 0,
    current: Window | undefined,
    currentId = '',
    dispose: (() => void) | undefined;
  function clear(close = true) {
    revision++;
    const previous = current;
    current = undefined;
    currentId = '';
    dispose?.();
    dispose = undefined;
    if (close && previous && !previous.closed) previous.close();
  }
  return {
    close: clear,
    async open(eventId: string) {
      if (!deps.secure()) throw new Error('画中画窗口需要 HTTPS 安全连接');
      const api = deps.api();
      if (!api)
        throw new Error('当前浏览器不支持 Document PiP，请使用支持该功能的桌面版 Chrome 或 Edge');
      if (current && !current.closed && currentId === eventId) {
        current.focus();
        return;
      }
      clear();
      const operation = revision;
      // Must run synchronously inside the original click, before API calls or lazy imports.
      const requested = api.requestWindow({
        width: 400,
        height: 560,
        disallowReturnToOpener: true,
      });
      const target = await requested;
      if (operation !== revision) {
        target.close();
        return;
      }
      current = target;
      currentId = eventId;
      const hide = () => {
        if (current === target) clear(false);
      };
      target.addEventListener('pagehide', hide, { once: true });
      try {
        await deps.authorize(eventId);
        if (operation !== revision || target.closed) return;
        const render = await deps.loadRenderer();
        if (operation !== revision || target.closed) return;
        const unmount = render(target, eventId);
        dispose = () => {
          target.removeEventListener('pagehide', hide);
          unmount();
        };
      } catch (error) {
        if (operation !== revision) return;
        target.removeEventListener('pagehide', hide);
        clear();
        throw error;
      }
    },
  };
}
