import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../apps/api/src/config.js';
import { mapUpstreamUrl, proxyMap } from '../apps/api/src/services/map-proxy.js';
const credentials = { key: 'test-public-js-key', securityCode: 'test-server-only-secret' };
const original = { key: config.VITE_AMAP_KEY, securityCode: config.AMAP_SECURITY_JS_CODE };
beforeEach(() => {
  config.VITE_AMAP_KEY = credentials.key;
  config.AMAP_SECURITY_JS_CODE = credentials.securityCode;
});
afterEach(() => {
  config.VITE_AMAP_KEY = original.key;
  config.AMAP_SECURITY_JS_CODE = original.securityCode;
});
describe('restricted AMap security proxy', () => {
  it('uses only fixed upstream hosts and replaces client-supplied credentials', () => {
    const url = mapUpstreamUrl(
      '/v3/place/text',
      new URLSearchParams({
        keywords: '上海场馆',
        type_: 'text',
        antiCrab: 'sdk-generated-token',
        key: 'caller-key',
        jscode: 'caller-code',
        callback: 'AMap.callback_1',
      }),
      credentials,
    );
    expect(url.origin).toBe('https://restapi.amap.com');
    expect(url.searchParams.get('type_')).toBe('text');
    expect(url.searchParams.get('antiCrab')).toBe('sdk-generated-token');
    expect(url.searchParams.get('key')).toBe(credentials.key);
    expect(url.searchParams.get('jscode')).toBe(credentials.securityCode);
    expect(mapUpstreamUrl('/v4/map/styles', new URLSearchParams(), credentials).origin).toBe(
      'https://webapi.amap.com',
    );
  });
  it('rejects arbitrary destinations, unknown parameters, callback injection and excess parameters', () => {
    expect(() =>
      mapUpstreamUrl('/https://example.com', new URLSearchParams(), credentials),
    ).toThrow('不支持的地图服务路径');
    expect(() =>
      mapUpstreamUrl(
        '/v3/place/text',
        new URLSearchParams({ url: 'http://127.0.0.1' }),
        credentials,
      ),
    ).toThrow('不支持的参数');
    expect(() =>
      mapUpstreamUrl('/v3/place/text', new URLSearchParams({ callback: 'alert(1)' }), credentials),
    ).toThrow('回调名称无效');
    expect(() =>
      mapUpstreamUrl(
        '/v3/place/text',
        new URLSearchParams({ keywords: 'x'.repeat(9000) }),
        credentials,
      ),
    ).toThrow('参数超限');
  });
  it('forwards no browser cookies and disables redirects', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('{"status":"1"}', { headers: { 'Content-Type': 'application/json' } }),
      );
    const result = await proxyMap(
      '/v3/place/text',
      new URLSearchParams({ keywords: '场馆' }),
      fetcher,
    );
    expect(result.body.toString()).toBe('{"status":"1"}');
    expect(result.contentType).toContain('application/json');
    const options = fetcher.mock.calls[0]![1];
    expect(options?.redirect).toBe('error');
    expect(options?.headers).toBeUndefined();
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it('does not call the upstream without complete server configuration', async () => {
    config.AMAP_SECURITY_JS_CODE = '';
    const fetcher = vi.fn<typeof fetch>();
    await expect(proxyMap('/v3/place/text', new URLSearchParams(), fetcher)).rejects.toMatchObject({
      code: 'MAP_NOT_CONFIGURED',
      status: 503,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sanitizes upstream failures instead of returning a URL containing the security code', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('failed jscode=' + credentials.securityCode));
    await expect(proxyMap('/v3/place/text', new URLSearchParams(), fetcher)).rejects.toMatchObject({
      code: 'MAP_UPSTREAM_UNAVAILABLE',
      message: '地图服务连接失败，请稍后重试',
      status: 502,
    });
  });
  it('rejects overlarge responses and preserves JSONP content type', async () => {
    const large = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    await expect(proxyMap('/v3/place/text', new URLSearchParams(), large)).rejects.toMatchObject({
      code: 'MAP_UPSTREAM_UNAVAILABLE',
    });
    const jsonp = vi.fn<typeof fetch>().mockResolvedValue(new Response('cb({"status":"1"})'));
    const result = await proxyMap('/v3/place/text', new URLSearchParams({ callback: 'cb' }), jsonp);
    expect(result.contentType).toContain('application/javascript');
  });
});
