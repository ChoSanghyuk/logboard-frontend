import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '../AppProviders';
import { createQueryClient } from '../api/queryClient';
import { routes } from '../routes';

function testQueryClient() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return client;
}

/** Render a single component inside all app providers. */
export function renderWithProviders(ui: ReactElement) {
  const client = testQueryClient();
  // `wrapper` (not inline JSX) so `rerender` keeps the providers.
  return render(ui, {
    wrapper: ({ children }) => <AppProviders queryClient={client}>{children}</AppProviders>,
  });
}

/** Render the full app router at `path`. `router` lets tests read the location or go back. */
export function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <AppProviders queryClient={testQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...result, router };
}
