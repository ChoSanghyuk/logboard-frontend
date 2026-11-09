import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { errorLogKey, handleErrorLogError } from './errorLogs';
import type { components } from './schema';

export type AnalysisDto = components['schemas']['AnalysisDto'];
export type AnalysisRequest = components['schemas']['AnalysisRequest'];

export const POLL_MS = 2000;

const analysisKey = (id: number) => ['analysis', id];
/** Nested under the error log key, so invalidating the error log also refreshes its history. */
const historyKey = (errorLogId: string) => [...errorLogKey(errorLogId), 'analyses'];

/** GET /error-logs/{id}/analyses — newest first. */
export const useAnalysisHistory = (errorLogId: string) =>
  useQuery({
    queryKey: historyKey(errorLogId),
    queryFn: () => unwrap(api.GET('/api/error-logs/{id}/analyses', { params: { path: { id: errorLogId } } })),
  });

/**
 * GET /analyses/{id}, polled every 2s while PENDING; stops on DONE/FAILED.
 * `initial` (e.g. the error log's latestAnalysis) avoids a first fetch when it is already finished.
 */
export const useAnalysis = (id: number | null, initial?: AnalysisDto | null) =>
  useQuery({
    queryKey: analysisKey(id ?? -1),
    queryFn: () => unwrap(api.GET('/api/analyses/{id}', { params: { path: { id: id! } } })),
    enabled: id != null,
    initialData: initial?.id === id && initial ? initial : undefined,
    // A finished analysis never changes. A PENDING one is fresh until the next poll (no extra fetch on mount).
    staleTime: (q) => (q.state.data?.status === 'PENDING' ? POLL_MS : Infinity),
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? POLL_MS : false),
  });

/** POST /error-logs/{id}/analyses → 202 PENDING. 409 INVALID_STATUS → message + refetch the error log. */
export function useStartAnalysis(errorLogId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AnalysisRequest) =>
      unwrap(api.POST('/api/error-logs/{id}/analyses', { params: { path: { id: errorLogId } }, body })),
    meta: { silentError: true },
    onSuccess: (analysis) => {
      qc.setQueryData(analysisKey(analysis.id), analysis);
      return qc.invalidateQueries({ queryKey: historyKey(errorLogId) });
    },
    onError: (error) => handleErrorLogError(qc, errorLogId, error),
  });
}
