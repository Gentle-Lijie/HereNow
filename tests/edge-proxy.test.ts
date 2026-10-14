import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../edge-functions/api/[[path]].js';

const env = { API_PROXY_SECRET: 'a'.repeat(64) };
afterEach(() => vi.unstubAllGlobals());

describe('Makers API transport', () => {
  it('fails closed when the server-only secret is absent', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await onRequest({
      request: new Request('https://checkin.lijie.space/api/context'),
      env: {},
    });
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves cookies, CSRF, idempotency and original body while stripping spoofed IP headers', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('{"code":"OK"}', {
          headers: { 'Set-Cookie': 'hn_admin=test; HttpOnly; Secure; Path=/api; SameSite=Lax' },
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const original = '{"answers":{"code":"000123"}}';
    const request = Object.assign(
      new Request('https://checkin.lijie.space/api/public/checkins?test=1', {
        method: 'POST',
        body: original,
        headers: {
          cookie: 'hn_browser=test',
          origin: 'https://checkin.lijie.space',
          'x-csrf-token': 'csrf',
          'idempotency-key': 'key',
          'x-session-id': 'session',
          'x-forwarded-for': '1.1.1.1',
          'x-herenow-client-ip': '1.1.1.1',
          'x-herenow-proxy-secret': 'attacker',
        },
      }),
      { eo: { clientIp: '203.0.113.8' } },
    );
    const response = await onRequest({ request, env });
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe('https://checkin-api.lijie.space/api/public/checkins?test=1');
    const headers = new Headers(options.headers);
    expect(headers.get('cookie')).toBe('hn_browser=test');
    expect(headers.get('origin')).toBe('https://checkin.lijie.space');
    expect(headers.get('x-csrf-token')).toBe('csrf');
    expect(headers.get('idempotency-key')).toBe('key');
    expect(headers.get('x-session-id')).toBe('session');
    expect(headers.get('x-forwarded-for')).toBeNull();
    expect(headers.get('x-herenow-client-ip')).toBe('203.0.113.8');
    expect(headers.get('x-herenow-proxy-secret')).toBe(env.API_PROXY_SECRET);
    expect(new TextDecoder().decode(options.body as ArrayBuffer)).toBe(original);
    expect(options.body).toBeInstanceOf(ArrayBuffer);
    expect(headers.get('content-length')).toBe(
      String(new TextEncoder().encode(original).byteLength),
    );
    expect(options.redirect).toBe('manual');
    expect(response.headers.get('set-cookie')).toContain('hn_admin=test');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not follow backend redirects or leak upstream errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('internal credentials');
      }),
    );
    const response = await onRequest({
      request: new Request('https://checkin.lijie.space/api/context'),
      env,
    });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('internal credentials');
  });

  it('transports imports above the runtime helper 1 MB limit without altering bytes', async () => {
    const original = new Uint8Array(2 * 1024 * 1024).fill(123);
    const request = new Request('https://checkin.lijie.space/api/admin/events/1/imports', {
      method: 'POST',
      body: original,
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
    });
    const helper = vi.spyOn(request, 'arrayBuffer').mockRejectedValue(new Error('OverSize'));
    const fetcher = vi.fn(async (_url: URL, options: RequestInit) => {
      expect(options.body).toBeInstanceOf(ArrayBuffer);
      expect(Buffer.from(options.body as ArrayBuffer).equals(Buffer.from(original))).toBe(true);
      expect(new Headers(options.headers).get('content-length')).toBe(String(original.byteLength));
      expect(new Headers(options.headers).get('content-type')).toBe(
        'multipart/form-data; boundary=test',
      );
      return new Response('{}');
    });
    vi.stubGlobal('fetch', fetcher);
    expect((await onRequest({ request, env })).status).toBe(200);
    expect(helper).not.toHaveBeenCalled();
  });

  it('bounds chunked uploads even when Content-Length is absent', async () => {
    const request = new Request('https://checkin.lijie.space/api/admin/events/1/imports', {
      method: 'POST',
      body: new Uint8Array(6 * 1024 * 1024 + 1),
    });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect((await onRequest({ request, env })).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves JSON bytes when the platform stream yields ArrayBuffer chunks', async () => {
    const original = new TextEncoder().encode('{"text":"中文","code":"000123"}');
    const request = new Request('https://checkin.lijie.space/api/admin/login', { method: 'POST' });
    // The EdgeOne reader differs from the DOM type, so model its runtime boundary explicitly.
    const stream = new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue(original.slice(0, 15).buffer);
        controller.enqueue(original.slice(15).buffer);
        controller.close();
      },
    });
    vi.spyOn(request, 'body', 'get').mockReturnValue(
      stream as ReadableStream<Uint8Array<ArrayBuffer>>,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: URL, options: RequestInit) => {
        expect(Buffer.from(options.body as ArrayBuffer).equals(Buffer.from(original))).toBe(true);
        return new Response('{}');
      }),
    );
    expect((await onRequest({ request, env })).status).toBe(200);
  });
});
