// Only transport runs on Makers; authorization, transactions and business rules run on ssh b.
interface ProxyContext {
  request: Request & { eo?: { clientIp?: string } };
  env: { API_PROXY_SECRET?: string };
}
const forwardedHeaders = [
  'accept',
  'content-type',
  'cookie',
  'origin',
  'user-agent',
  'x-csrf-token',
  'x-session-id',
  'idempotency-key',
];
const error = (code: string, message: string, status: number) =>
  Response.json({ code, message }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequest({ request, env }: ProxyContext): Promise<Response> {
  if (!env.API_PROXY_SECRET || env.API_PROXY_SECRET.length < 64)
    return error('PROXY_NOT_CONFIGURED', '服务尚未配置，请联系管理员', 503);
  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith('/api/')) return error('NOT_FOUND', '接口不存在', 404);
  // Concatenating onto a fixed origin prevents absolute-path/URL tricks from changing the host.
  const target = new URL(`https://checkin-api.lijie.space${incoming.pathname}${incoming.search}`);
  const headers = new Headers();
  for (const key of forwardedHeaders) {
    const value = request.headers.get(key);
    if (value !== null) headers.set(key, value);
  }
  headers.set('x-herenow-proxy-secret', env.API_PROXY_SECRET);
  // eo.clientIp is runtime metadata, never a browser-supplied forwarding header.
  if (request.eo?.clientIp) headers.set('x-herenow-client-ip', request.eo.clientIp);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      signal: controller.signal,
      redirect: 'manual',
    });
    // Keep separate Set-Cookie headers, the body, status and download headers intact.
    const response = new Response(upstream.body, upstream);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return error('UPSTREAM_UNAVAILABLE', '网络连接中断，请使用原请求重试', 502);
  } finally {
    clearTimeout(timeout);
  }
}
