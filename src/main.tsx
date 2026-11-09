import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppProviders } from './AppProviders';
import { createQueryClient } from './api/queryClient';
import { routes } from './routes';

async function enableMocks() {
  if (import.meta.env.VITE_USE_MOCKS !== 'true') return;
  const { worker } = await import('./mocks/browser');
  await worker.start({
    // Warn only about unmocked API calls (contract drift); let assets through.
    onUnhandledFrame: ({ frame, defaults }) => {
      const { request } = frame.data as { request?: Request };
      if (request && new URL(request.url).pathname.startsWith('/api/')) defaults.warn();
    },
  });
}

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);

enableMocks().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProviders queryClient={queryClient}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
});
