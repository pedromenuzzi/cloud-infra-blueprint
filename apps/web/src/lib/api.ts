/**
 * Tiny typed HTTP client used by the web app to talk to the NestJS backend.
 *
 * Design goals:
 *
 * - **Offline-first.** If the backend isn't running (or fails), every
 *   `try`-wrapped call short-circuits with a clean error so callers can fall
 *   back to bundled data and the UI stays usable in pure-frontend demos.
 * - **No external dep.** Plain `fetch` + `AbortController`. F4 introduces a
 *   generated SDK from OpenAPI; until then this single file is enough.
 * - **Predictable shape.** Throws `ApiError` (with `status`, `code`, `body`).
 */

const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const DEFAULT_TIMEOUT_MS = 8000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

interface RequestOptions {
  /** Abort signal merged with the internal timeout. */
  signal?: AbortSignal;
  /** Override the default 8s timeout (`0` to disable). */
  timeoutMs?: number;
  /** Extra headers; `content-type` defaults to `application/json` for bodies. */
  headers?: Record<string, string>;
  /** Send cookies on the request. Defaults to `true`. */
  credentials?: RequestCredentials;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeout > 0) timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
  if (opts.signal) opts.signal.addEventListener('abort', () => ctrl.abort(opts.signal!.reason));

  const headers: Record<string, string> = {
    accept: 'application/json',
    ...opts.headers,
  };
  if (body !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: opts.credentials ?? 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    const reason = (err as Error).message ?? 'network error';
    throw new ApiError(0, 'network_unavailable', `${method} ${path} failed: ${reason}`);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const code = (parsed as { code?: string } | null)?.code ?? `http_${res.status}`;
    const message =
      (parsed as { message?: string } | null)?.message ?? `${method} ${path} -> ${res.status}`;
    throw new ApiError(res.status, code, message, parsed);
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>('POST', path, body, opts),
  patch: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>('PATCH', path, body, opts),
  put: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>('PUT', path, body, opts),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
};

/* -------------------------------------------------------------------------- */
/* Backwards-compatible helpers (kept so existing callers don't break).       */
/* -------------------------------------------------------------------------- */

/** @deprecated use `api.get` */
export const apiGet = <T>(path: string) => api.get<T>(path);
/** @deprecated use `api.post` */
export const apiPost = <T>(path: string, body: unknown) => api.post<T>(path, body);
