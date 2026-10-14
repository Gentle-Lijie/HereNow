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
});
