import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
class Script {
  src = '';
  async = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  removed = false;
  remove() {
    this.removed = true;
  }
}
const sdk = { Map: class {}, Marker: class {}, Circle: class {}, plugin() {} };
let scripts: Script[];
let browser: { AMap?: typeof sdk; _AMapSecurityConfig?: { serviceHost: string } };
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  scripts = [];
  browser = {};
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', {
    createElement: () => new Script(),
    head: { append: (s: Script) => scripts.push(s) },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('map SDK loading recovery', () => {
  it('reports missing configuration without making a third-party request', async () => {
    const { loadMapSdk } = await import('../apps/web/src/services/map-sdk.js');
    await expect(loadMapSdk('   ')).rejects.toThrow('地图尚未配置');
    expect(scripts).toHaveLength(0);
  });
  it('shares one script between concurrent initialization attempts', async () => {
    const { loadMapSdk } = await import('../apps/web/src/services/map-sdk.js');
    const first = loadMapSdk('test-only-js-key', 'http://localhost/api/_AMapService'),
      second = loadMapSdk('test-only-js-key', 'http://localhost/api/_AMapService');
    expect(scripts).toHaveLength(1);
    expect(browser._AMapSecurityConfig).toEqual({
      serviceHost: 'http://localhost/api/_AMapService',
    });
    browser.AMap = sdk;
    scripts[0]!.onload?.();
    expect(await first).toBe(sdk);
    expect(await second).toBe(sdk);
    expect(vi.getTimerCount()).toBe(0);
    expect(scripts[0]!.onload).toBeNull();
  });
  it('cleans up a failed script and loads a new script when retried', async () => {
    const { loadMapSdk } = await import('../apps/web/src/services/map-sdk.js');
    const first = loadMapSdk('test-only-js-key', 'http://localhost/api/_AMapService'),
      rejected = expect(first).rejects.toThrow('地图加载失败');
    scripts[0]!.onerror?.();
    await rejected;
    expect(scripts[0]!.removed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const retry = loadMapSdk('test-only-js-key', 'http://localhost/api/_AMapService');
    expect(scripts).toHaveLength(2);
    browser.AMap = sdk;
    scripts[1]!.onload?.();
    expect(await retry).toBe(sdk);
  });
  it('does not treat an onload event without a usable SDK as success', async () => {
    const { loadMapSdk } = await import('../apps/web/src/services/map-sdk.js');
    const promise = loadMapSdk('test-only-js-key', 'http://localhost/api/_AMapService'),
      rejected = expect(promise).rejects.toThrow('地图服务未能初始化');
    scripts[0]!.onload?.();
    await rejected;
    expect(scripts[0]!.removed).toBe(true);
  });
  it('times out, removes event handlers and permits a subsequent retry', async () => {
    const { loadMapSdk } = await import('../apps/web/src/services/map-sdk.js');
    const promise = loadMapSdk('test-only-js-key', 'http://localhost/api/_AMapService'),
      rejected = expect(promise).rejects.toThrow('地图加载超时');
    await vi.advanceTimersByTimeAsync(12000);
    await rejected;
    expect(scripts[0]!.removed).toBe(true);
    expect(scripts[0]!.onload).toBeNull();
    expect(scripts[0]!.onerror).toBeNull();
    const retry = loadMapSdk('test-only-js-key', 'http://localhost/api/_AMapService');
    browser.AMap = sdk;
    scripts[1]!.onload?.();
    expect(await retry).toBe(sdk);
  });
  it('reuses a usable SDK without another network request', async () => {
    browser.AMap = sdk;
    const { loadMapSdk } = await import('../apps/web/src/services/map-sdk.js');
    expect(await loadMapSdk('test-only-js-key', 'http://localhost/api/_AMapService')).toBe(sdk);
    expect(scripts).toHaveLength(0);
  });
});
