import createClient from 'openapi-fetch';
import type { components, paths } from './schema';

export type ApiError = components['schemas']['ApiError'];

/** Thrown by `unwrap` for any non-2xx response (or network failure). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.code;
    this.details = body.details ?? {};
  }
}

// Paths in the schema already include the `/api` prefix. An absolute origin is used so the
// same client works in the browser and in Node (tests), where relative URLs are rejected.
// `fetch` is looked up per call so MSW's patched fetch is used in tests (it is installed after import).
export const api = createClient<paths>({
  baseUrl: window.location.origin,
  fetch: (request) => globalThis.fetch(request),
});

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiError).code === 'string' &&
    typeof (value as ApiError).message === 'string'
  );
}

/**
 * Turns an openapi-fetch result into data or a thrown ApiRequestError.
 * Usage: `queryFn: () => unwrap(api.GET('/api/servers'))`
 */
export async function unwrap<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result;
  try {
    result = await request;
  } catch {
    throw new ApiRequestError(0, {
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the server.',
      details: {},
    });
  }
  const { data, error, response } = result;
  if (error !== undefined || !response.ok) {
    throw new ApiRequestError(
      response.status,
      isApiError(error)
        ? error
        : { code: `HTTP_${response.status}`, message: response.statusText || 'Request failed.', details: {} },
    );
  }
  return data as T;
}
