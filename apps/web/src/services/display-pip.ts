import { createApp } from 'vue';
import { api } from './api';
import { createPipController, type DocumentPipApi } from './pip-controller';

const controller = createPipController({
  secure: () => window.isSecureContext,
  api: () =>
    (window as Window & { documentPictureInPicture?: DocumentPipApi }).documentPictureInPicture,
  async authorize(eventId) {
    const result = await api<{ display_url: string }>(`/admin/events/${eventId}/display-sessions`, {
      method: 'POST',
    });
    const token = new URLSearchParams(
      new URL(result.display_url, location.origin).hash.slice(1),
    ).get('d');
    if (!token) throw new Error('展示凭证无效，请重试');
    await api(`/display/events/${eventId}/connect`, { method: 'POST', body: { token } });
  },
  async loadRenderer() {
    const [{ default: DisplayCode }, { default: css }] = await Promise.all([
      import('../display/DisplayCode.vue'),
      import('../display/display-code.css?inline'),
    ]);
    return (target, eventId) => {
      const style = target.document.createElement('style');
      let branding = '';
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules))
            if (rule.cssText.includes('.brand') || rule.cssText.includes('.event-logo'))
              branding += rule.cssText;
        } catch {
          /* Cross-origin styles are not needed by the lightweight display. */
        }
      }
      style.textContent = css + branding;
      target.document.head.append(style);
      target.document.title = '活动签到';
      target.document.body.style.margin = '0';
      const root = target.document.createElement('div');
      target.document.body.append(root);
      const app = createApp(DisplayCode, {
        eventId,
        timerHost: target,
        origin: location.origin,
        onTitle: (value: string) => {
          target.document.title = value;
        },
      });
      app.mount(root);
      return () => {
        app.unmount();
        root.remove();
        style.remove();
      };
    };
  },
});
const close = () => controller.close();
window.addEventListener('pagehide', close);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    window.removeEventListener('pagehide', close);
    close();
  });
export const openDisplayPip = controller.open;
