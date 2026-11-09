import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { api, ApiRequestError, unwrap } from './client';
import { notifyError } from './queryClient';
import type { components, paths } from './schema';

export type ErrorLogSearchRequest = components['schemas']['SearchRequest'];
export type ErrorLogDetail = components['schemas']['ErrorLogDetail'];
export type CropRequest = components['schemas']['CropRequest'];
export type ErrorLogListQuery = NonNullable<paths['/api/error-logs']['get']['parameters']['query']>;

export const errorLogKey = (id: string) => ['error-log', id];

/** POST /error-logs/search. NO_EXCEPTION_FOUND / FETCH_FAILED are rendered inline by the caller. */
export const useSearchErrorLog = () =>
  useMutation({
    mutationFn: (body: ErrorLogSearchRequest) => unwrap(api.POST('/api/error-logs/search', { body })),
    meta: { silentError: true },
  });

/** GET /error-logs (paged, newest first). Keeps the previous page while the next one loads. */
export const useErrorLogs = (query: ErrorLogListQuery, enabled = true) =>
  useQuery({
    queryKey: ['error-logs', query],
    queryFn: () => unwrap(api.GET('/api/error-logs', { params: { query } })),
    placeholderData: keepPreviousData,
    enabled,
  });

/** GET /error-logs/{id}. NOT_FOUND is rendered inline by the page. */
export const useErrorLog = (id: string) =>
  useQuery({
    queryKey: errorLogKey(id),
    queryFn: () => unwrap(api.GET('/api/error-logs/{id}', { params: { path: { id } } })),
    meta: { silentError: true },
  });

/** 409 INVALID_STATUS (changed elsewhere) → message + refetch the error log; other errors → notification. */
export function handleErrorLogError(qc: QueryClient, id: string, error: Error) {
  if (error instanceof ApiRequestError && error.code === 'INVALID_STATUS') {
    notifications.show({
      color: 'yellow',
      title: 'Status changed',
      message: `${error.message}. Showing the latest state.`,
    });
    return qc.invalidateQueries({ queryKey: errorLogKey(id) });
  }
  notifyError(error);
}

const isValidation = (error: Error) => error instanceof ApiRequestError && error.code === 'VALIDATION_FAILED';

/**
 * A mutation that returns the updated ErrorLogDetail and writes it into the cache.
 * 409 INVALID_STATUS (someone else changed it) → message + refetch; other errors → notification.
 * With `formErrors`, 400 VALIDATION_FAILED is left to the caller's form.
 */
function useErrorLogMutation<V>(
  id: string,
  fn: (path: { path: { id: string } }, vars: V) => Promise<ErrorLogDetail>,
  formErrors = false,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => fn({ path: { id } }, vars),
    meta: { silentError: true },
    onSuccess: (detail) => qc.setQueryData(errorLogKey(id), detail),
    onError: (error) => {
      if (!(formErrors && isValidation(error))) handleErrorLogError(qc, id, error);
    },
  });
}

export const useCropErrorLog = (id: string) =>
  useErrorLogMutation(id, (params, body: CropRequest) =>
    unwrap(api.PATCH('/api/error-logs/{id}/crop', { params, body })),
  );

export const useConfirmErrorLog = (id: string) =>
  useErrorLogMutation(id, (params) => unwrap(api.POST('/api/error-logs/{id}/confirm', { params })));

export const useDiscardErrorLog = (id: string) =>
  useErrorLogMutation(id, (params) => unwrap(api.POST('/api/error-logs/{id}/discard', { params })));

export const useTerminateErrorLog = (id: string) =>
  useErrorLogMutation(
    id,
    (params, body: components['schemas']['TerminateRequest']) =>
      unwrap(api.POST('/api/error-logs/{id}/terminate', { params, body })),
    true,
  );

export const useDevRequiredErrorLog = (id: string) =>
  useErrorLogMutation(
    id,
    (params, body: components['schemas']['DevRequiredRequest']) =>
      unwrap(api.POST('/api/error-logs/{id}/dev-required', { params, body })),
    true,
  );
