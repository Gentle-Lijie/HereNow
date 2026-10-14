import { reactive } from 'vue';
export interface User {
  id: string;
  username: string;
  role: 'admin' | 'operator';
}
export const session = reactive<{ user: User | null; csrf: string; ready: boolean }>({
  user: null,
  csrf: '',
  ready: false,
});
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
let contextPromise: Promise<void> | null = null;
export async function loadContext(force = false) {
  if (session.ready && !force) return;
  if (contextPromise) return contextPromise;
  contextPromise = (async () => {
    const r = await fetch('/api/context', { credentials: 'same-origin' });
    if (!r.ok) throw new ApiError('NETWORK_ERROR', '无法连接服务，请重试', r.status);
    const data = (await r.json()) as { user: User | null; csrf_token: string };
    session.user = data.user;
    session.csrf = data.csrf_token;
    session.ready = true;
  })().finally(() => {
    contextPromise = null;
  });
  return contextPromise;
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  await loadContext();
  const headers: Record<string, string> = { 'x-csrf-token': session.csrf, ...options.headers };
  let requestBody: BodyInit | undefined;
  if (options.body instanceof FormData) requestBody = options.body;
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(options.body);
  }
  let r: Response;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    r = await fetch(`/api${path}`, {
      signal: controller.signal,
      method: options.method ?? 'GET',
      body: requestBody,
      headers,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', '网络连接中断，请检查网络后重试', 0);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
  let data: T & { code?: string; message?: string };
  try {
    data = (await r.json()) as T & { code?: string; message?: string };
  } catch {
    throw new ApiError('NETWORK_ERROR', '未能确认服务响应，请重试查询上次结果', 0);
  }
  if (!r.ok) throw new ApiError(data.code ?? 'ERROR', data.message ?? '操作失败', r.status);
  return data;
}
export const errorMessage = (e: unknown) => {
  if (e && typeof e === 'object' && 'issues' in e && Array.isArray(e.issues)) {
    const first = e.issues[0] as { message?: unknown } | undefined;
    if (typeof first?.message === 'string') return first.message;
  }
  return e instanceof Error ? e.message : '操作失败，请重试';
};
export const formatTime = (iso: string, timezone = 'Asia/Shanghai') =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
