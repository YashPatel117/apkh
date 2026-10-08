/**
 * A small client for the apkh-api routes an integration token can use. Every
 * call returns a result instead of throwing, so tools can hand the API's own
 * message back to the model.
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ApiConfig {
  baseUrl: string;
  token: string | undefined;
  timeoutMs: number;
}

export function configFromEnv(env = process.env): ApiConfig {
  const timeout = Number(env.APKH_TIMEOUT_MS);
  return {
    baseUrl: (env.APKH_API_URL?.trim() || 'http://localhost:3000').replace(
      /\/+$/,
      '',
    ),
    token: env.APKH_TOKEN?.trim() || undefined,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

export class ApkhClient {
  constructor(private readonly config: ApiConfig) {}

  get(path: string) {
    return this.request<unknown>('GET', path);
  }

  post(path: string, body: unknown) {
    return this.request<unknown>('POST', path, body);
  }

  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    if (!this.config.token) {
      return {
        ok: false,
        error:
          'apkh-mcp has no token. Create one with "Can read and search notes" in the Knowledge Hub (Profile → Integrations) and set APKH_TOKEN in this MCP server\'s config.',
      };
    }
    const url = `${this.config.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === 'TimeoutError';
      return {
        ok: false,
        error: timedOut
          ? `The Knowledge Hub API didn't answer within ${Math.round(this.config.timeoutMs / 1000)} s.`
          : `Can't reach the Knowledge Hub API at ${this.config.baseUrl}. Is apkh-api running? (${(error as Error).message})`,
      };
    }

    const text = await response.text();
    let payload: unknown = undefined;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      // Not JSON (a proxy's error page, say): reported below by status.
    }
    if (!response.ok) {
      return { ok: false, error: errorMessage(response.status, payload) };
    }
    return { ok: true, data: payload as T };
  }
}

/** NestJS errors are { message: string | string[], statusCode }. */
function errorMessage(status: number, payload: unknown): string {
  const message = (payload as { message?: unknown } | undefined)?.message;
  const text = Array.isArray(message)
    ? message.join('; ')
    : typeof message === 'string'
      ? message
      : '';
  const prefix =
    status === 401
      ? 'The token was rejected'
      : status === 403
        ? 'Not allowed'
        : status === 404
          ? 'Not found'
          : status === 429
            ? 'Rate limited'
            : `The API answered ${status}`;
  return text ? `${prefix}: ${text}` : `${prefix}.`;
}
