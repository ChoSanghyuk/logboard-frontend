import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

export type ServerDto = components['schemas']['ServerDto'];
export type ServerUpsert = components['schemas']['ServerUpsert'];
export type InstanceDto = components['schemas']['InstanceDto'];
export type InstanceUpsert = components['schemas']['InstanceUpsert'];

const SERVERS = ['servers'];

export const useServers = () =>
  useQuery({ queryKey: SERVERS, queryFn: () => unwrap(api.GET('/api/servers')) });

export const useLogPatterns = () =>
  useQuery({
    queryKey: ['log-patterns'],
    queryFn: () => unwrap(api.GET('/api/log-patterns')),
    staleTime: Infinity,
  });

/** Create when `id` is undefined, otherwise update. Errors are handled by the form (field mapping). */
export function useSaveServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: ServerUpsert }) =>
      id === undefined
        ? unwrap(api.POST('/api/servers', { body }))
        : unwrap(api.PUT('/api/servers/{id}', { params: { path: { id } }, body })),
    meta: { silentError: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVERS }),
  });
}

export function useDeleteServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap(api.DELETE('/api/servers/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVERS }),
  });
}

/**
 * Tests every instance. Always 200 for a known id: `ok:false` (any instance failed) is a result, not an HTTP error.
 * A first successful test of an instance pins its host key.
 */
export function useTestServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap(api.POST('/api/servers/{id}/test', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVERS }),
  });
}

/** Forget an instance's pinned host key; the next test or search trusts the key presented then. */
export function useResetHostKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, instanceId }: { id: number; instanceId: number }) =>
      unwrap(
        api.POST('/api/servers/{id}/instances/{instanceId}/reset-host-key', {
          params: { path: { id, instanceId } },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVERS }),
  });
}
