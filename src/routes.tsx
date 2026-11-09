import type { RouteObject } from 'react-router';
import { Navigate } from 'react-router';
import { Center, Loader, Text } from '@mantine/core';
import { AppLayout } from './components/AppLayout';

// Pages are code-split: each route loads its chunk on first visit.
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    hydrateFallbackElement: (
      <Center h="100vh">
        <Loader />
      </Center>
    ),
    children: [
      { index: true, element: <Navigate to="/search" replace /> },
      {
        path: 'search',
        lazy: () => import('./pages/SearchPage').then((m) => ({ Component: m.SearchPage })),
      },
      {
        path: 'errors',
        lazy: () => import('./pages/ErrorListPage').then((m) => ({ Component: m.ErrorListPage })),
      },
      {
        path: 'errors/:id',
        lazy: () => import('./pages/ErrorDetailPage').then((m) => ({ Component: m.ErrorDetailPage })),
      },
      {
        path: 'servers',
        lazy: () => import('./pages/ServersPage').then((m) => ({ Component: m.ServersPage })),
      },
      { path: 'settings', element: <Navigate to="/settings/llm" replace /> },
      {
        path: 'settings/llm',
        lazy: () => import('./pages/LlmEndpointsPage').then((m) => ({ Component: m.LlmEndpointsPage })),
      },
      {
        path: 'settings/prompts',
        lazy: () => import('./pages/PromptsPage').then((m) => ({ Component: m.PromptsPage })),
      },
      { path: '*', element: <Text c="dimmed">Page not found.</Text> },
    ],
  },
];
