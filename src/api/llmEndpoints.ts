import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

export type LlmEndpointDto = components['schemas']['LlmEndpointDto'];
export type LlmEndpointUpsert = components['schemas']['LlmEndpointUpsert'];

const KEY = ['llm-endpoints'];

export const useLlmEndpoints = () =>
  useQuery({ queryKey: KEY, queryFn: () => unwrap(api.GET('/api/llm-endpoints')) });

/** Create when `id` is undefined, otherwise update. Refetches the list (isDefault may change on others). */
export function useSaveLlmEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: LlmEndpointUpsert }) =>
      id === undefined
        ? unwrap(api.POST('/api/llm-endpoints', { body }))
        : unwrap(api.PUT('/api/llm-endpoints/{id}', { params: { path: { id } }, body })),
    meta: { silentError: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Errors are shown in the confirm dialog (e.g. 409 IN_USE). */
export function useDeleteLlmEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap(api.DELETE('/api/llm-endpoints/{id}', { params: { path: { id } } })),
    meta: { silentError: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export const useTestLlmEndpoint = () =>
  useMutation({
    mutationFn: (id: number) =>
      unwrap(api.POST('/api/llm-endpoints/{id}/test', { params: { path: { id } } })),
  });
