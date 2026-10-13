import { createServer, type Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { devEndpoints, waitForApi } from '../scripts/api-readiness.js';

async function listen(server: Server, port = 0) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  return { port: address.port, url: `http://127.0.0.1:${address.port}/api/health` };
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

describe('development API readiness gate', () => {
  it('waits through connection refusal until a delayed API listens', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ code: 'OK' }));
    });
    const address = await listen(server);
    await close(server);
    let ready = false;
    const waiting = waitForApi(address.url, { timeoutMs: 2000, pollIntervalMs: 20 });
    void waiting.then(() => {
      ready = true;
    });
    await delay(100);
    expect(ready).toBe(false);
    await listen(server, address.port);
    try {
      await waiting;
      expect(ready).toBe(true);
    } finally {
      await close(server);
    }
  });

  it('does not treat an open port, 503, invalid JSON or unrelated 200 as healthy', async () => {
    let calls = 0;
    const server = createServer((_request, response) => {
      calls++;
      if (calls === 1) {
        response.statusCode = 503;
        response.end('{"code":"OK"}');
      } else if (calls === 2) response.end('starting');
      else if (calls === 3) response.end('{"code":"STARTING"}');
      else response.end('{"code":"OK"}');
    });
    const address = await listen(server);
    try {
      await waitForApi(address.url, { timeoutMs: 1000, pollIntervalMs: 10 });
      expect(calls).toBe(4);
    } finally {
      await close(server);
    }
  });

  it('bounds hung health requests and reports a useful failure', async () => {
    const server = createServer(() => {
      /* API startup hangs without returning headers. */
    });
    const address = await listen(server);
    const started = Date.now();
    try {
      await expect(
        waitForApi(address.url, { timeoutMs: 150, requestTimeoutMs: 40, pollIntervalMs: 10 }),
      ).rejects.toThrow('API 未就绪');
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      await close(server);
    }
  });
});

describe('development endpoints', () => {
  it('uses consistent defaults and respects both configured ports', () => {
    expect(devEndpoints({})).toEqual({
      host: 'localhost',
      port: 5173,
      apiTarget: 'http://127.0.0.1:3001',
    });
    expect(devEndpoints({ PORT: '3012', APP_ORIGIN: 'http://127.0.0.1:5190' })).toEqual({
      host: '127.0.0.1',
      port: 5190,
      apiTarget: 'http://127.0.0.1:3012',
    });
  });
  it('rejects invalid ports and unsupported development TLS', () => {
    for (const port of ['0', '65536', 'NaN', '3.5'])
      expect(() => devEndpoints({ PORT: port })).toThrow('PORT');
    expect(() => devEndpoints({ APP_ORIGIN: 'https://localhost:5173' })).toThrow('TLS');
  });
});
