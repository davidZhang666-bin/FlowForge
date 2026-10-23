const pending = new Map<string, string>();
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token':
        document.cookie
          .split('; ')
          .find((cookie) => cookie.startsWith('ff_csrf='))
          ?.slice(8) ??
        sessionStorage.getItem('ff_csrf') ??
        '',
      ...init.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: { message?: string | string[] };
  };
  if (!response.ok) {
    if (response.status === 401 && !path.includes('/auth/login'))
      window.dispatchEvent(new Event('ff:unauthorized'));
    throw new ApiError(
      Array.isArray(data.error?.message)
        ? data.error.message.join('；')
        : (data.error?.message ?? '请求失败，请稍后重试'),
      response.status,
    );
  }
  return data as T;
}
export async function mutate<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const serialized = JSON.stringify(body);
  const signature = `${path}:${method}:${serialized}`;
  const key = pending.get(signature) ?? crypto.randomUUID();
  pending.set(signature, key);
  try {
    const result = await api<T>(path, {
      method,
      body: serialized,
      headers: { 'Idempotency-Key': key },
    });
    pending.delete(signature);
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) pending.delete(signature);
    throw error;
  }
}
export const tenantPath = (id: string, path: string): string => `/tenants/${id}${path}`;
