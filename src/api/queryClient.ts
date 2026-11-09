import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { ApiRequestError } from './client';

type AppMeta = {
  /** Skip the global error notification (the caller renders the error inline). */
  silentError?: boolean;
};

declare module '@tanstack/react-query' {
  interface Register {
    defaultError: Error;
    queryMeta: AppMeta;
    mutationMeta: AppMeta;
  }
}

export function notifyError(error: Error) {
  notifications.show({
    color: 'red',
    title: error instanceof ApiRequestError ? 'Request failed' : 'Error',
    message: error.message,
  });
}

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!query.meta?.silentError) notifyError(error);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (!mutation.meta?.silentError) notifyError(error);
      },
    }),
    defaultOptions: {
      queries: {
        // 4xx are definitive; retry other failures once.
        retry: (count, error) =>
          !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500) && count < 1,
      },
    },
  });
}
