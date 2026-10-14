import { config } from '../config.js';
import { fail } from './security.js';
const upstreams: Record<string, string> = {
  '/v3/log/init': 'https://restapi.amap.com/v3/log/init',
  '/v3/place/text': 'https://restapi.amap.com/v3/place/text',
  '/v5/place/text': 'https://restapi.amap.com/v5/place/text',
  '/v4/map/styles': 'https://webapi.amap.com/v4/map/styles',
};
const parameters = new Set([
  'key',
  'jscode',
  'keywords',
  'city',
  'citylimit',
  'city_limit',
  'region',
  'types',
  'type_',
  'antiCrab',
  'offset',
  'page',
  'page_size',
  'page_num',
  'extensions',
  'children',
  'show_fields',
  'output',
  'callback',
  'platform',
  'sdkversion',
  'logversion',
  'logversion2',
  'appname',
  's',
  '_a',
  'language',
  'styleid',
  'ispublic',
  'protocol',
  'client',
  'version',
  'csid',
  'ts',
  'scode',
  'eventId',
  'product',
  't',
  'resolution',
  'mob',
  'vt',
  'dpr',
  'scale',
  'label',
  'value',
]);
export function mapProxyReady() {
  return Boolean(config.VITE_AMAP_KEY && config.AMAP_SECURITY_JS_CODE);
}
export function mapUpstreamUrl(
  path: string,
  query: URLSearchParams,
  credentials: { key: string; securityCode: string },
): URL {
  const base = upstreams[path] ?? fail('MAP_PATH_NOT_ALLOWED', '不支持的地图服务路径', 404);
  if (query.toString().length > 8192 || [...query].length > 40)
    fail('INVALID_FORM', '地图请求参数超限');
  const url = new URL(base);
  for (const [key, value] of query) {
    if (!parameters.has(key) || value.length > 2000)
      fail('INVALID_FORM', '地图请求包含不支持的参数');
    if (key === 'key' || key === 'jscode') continue;
    if (key === 'callback' && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value))
      fail('INVALID_FORM', '地图回调名称无效');
    url.searchParams.append(key, value);
  }
  url.searchParams.set('key', credentials.key);
  url.searchParams.set('jscode', credentials.securityCode);
  return url;
}
export async function proxyMap(
  path: string,
  query: URLSearchParams,
  fetcher: typeof fetch = fetch,
) {
  const url = mapUpstreamUrl(path, query, {
    key: config.VITE_AMAP_KEY,
    securityCode: config.AMAP_SECURITY_JS_CODE,
  });
  if (!mapProxyReady()) fail('MAP_NOT_CONFIGURED', '地图授权配置尚未完成，请联系部署管理员', 503);
  // No cookies, authorization headers or caller-supplied destinations leave this service.
  try {
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.body) throw new Error('Map upstream unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Map response too large');
      }
      chunks.push(value);
    }
    return {
      body: Buffer.concat(chunks),
      contentType: query.has('callback')
        ? 'application/javascript; charset=utf-8'
        : 'application/json; charset=utf-8',
    };
  } catch {
    return fail('MAP_UPSTREAM_UNAVAILABLE', '地图服务连接失败，请稍后重试', 502);
  }
}
