import { setTimeout as delay } from 'node:timers/promises';

interface ReadinessOptions {
  timeoutMs?: number;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
}

/** Wait for a healthy API, rather than assuming that a listening port is ready. */
export async function waitForApi(url: string, options: ReadinessOptions = {}): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  const requestTimeoutMs = options.requestTimeoutMs ?? 1_000;
  const pollIntervalMs = options.pollIntervalMs ?? 200;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, deadline - Date.now()))),
        cache: 'no-store',
      });
      const result: unknown = await response.json();
      if (
        response.ok &&
        typeof result === 'object' &&
        result !== null &&
        'code' in result &&
        result.code === 'OK'
      ) {
        return;
      }
    } catch {
      // Connection refusals, unhealthy responses and incomplete startup are retried only here.
      // Business requests (especially check-in POSTs) are never replayed by this readiness gate.
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(pollIntervalMs, remaining));
  }

  throw new Error(
    `API 未就绪：${url}。请检查上方 API 日志和本机 MySQL 配置；首次启动请先运行 npm run setup。`,
  );
}

export function devEndpoints(env: Record<string, string | undefined>) {
  const origin = new URL(env.APP_ORIGIN ?? 'http://localhost:5173');
  const apiPort = Number(env.PORT ?? '3001');
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65_535) {
    throw new Error('PORT 必须是 1–65535 的整数');
  }
  if (origin.protocol !== 'http:') {
    throw new Error('本地 Vite 开发服务使用 HTTP；HTTPS 入口需另行配置 TLS 代理');
  }
  return {
    host: origin.hostname,
    port: Number(origin.port || '80'),
    apiTarget: `http://127.0.0.1:${apiPort}`,
  };
}
