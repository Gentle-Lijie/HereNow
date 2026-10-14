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
  new Response(JSON.stringify({ code, message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
const maxBodyBytes = 6 * 1024 * 1024; // Allows a 5 MB import plus multipart overhead.
class BodyTooLarge extends Error {}
function chunkBytes(value: unknown): Uint8Array {
  // EdgeOne stream readers return ArrayBuffer; Node/browser readers use Uint8Array views.
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('Unsupported request stream chunk');
}
async function readBody(request: Request): Promise<ArrayBuffer> {
  if (Number(request.headers.get('content-length')) > maxBodyBytes) throw new BodyTooLarge();
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = chunkBytes(value);
      size += chunk.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Pass the backing ArrayBuffer explicitly; runtimes differ in handling typed-array views.
  return body.buffer;
}

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
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request);
    if (body !== undefined) headers.set('content-length', String(body.byteLength));
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      // The EdgeOne arrayBuffer()/text() helpers have a 1 MB limit; use bounded stream reads.
      body,
      signal: controller.signal,
      redirect: 'manual',
    });
    // Keep separate Set-Cookie headers, the body, status and download headers intact.
    const response = new Response(upstream.body, upstream);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (cause) {
    if (cause instanceof BodyTooLarge) return error('PAYLOAD_TOO_LARGE', '上传内容过大', 413);
    return error('UPSTREAM_UNAVAILABLE', '网络连接中断，请使用原请求重试', 502);
  } finally {
    clearTimeout(timeout);
  }
}
