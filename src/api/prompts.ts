import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';

export type PromptTemplateDto = components['schemas']['PromptTemplateDto'];
export type PromptTemplateUpsert = components['schemas']['PromptTemplateUpsert'];

const KEY = ['prompts'];

export const usePrompts = () => useQuery({ queryKey: KEY, queryFn: () => unwrap(api.GET('/api/prompts')) });

/** Create when `id` is undefined, otherwise update. Refetches the list (isDefault may change on others). */
export function useSavePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: PromptTemplateUpsert }) =>
      id === undefined
        ? unwrap(api.POST('/api/prompts', { body }))
        : unwrap(api.PUT('/api/prompts/{id}', { params: { path: { id } }, body })),
    meta: { silentError: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Errors are shown in the confirm dialog (e.g. 409 IN_USE). */
export function useDeletePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap(api.DELETE('/api/prompts/{id}', { params: { path: { id } } })),
    meta: { silentError: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
