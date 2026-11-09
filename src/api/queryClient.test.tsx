import { useMutation, useQuery } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { server } from '../mocks/server';
import { renderWithProviders } from '../test/render';
import { api, unwrap } from './client';

function failServers() {
  server.use(
    http.get('*/api/servers', () =>
      HttpResponse.json(
        { code: 'FETCH_FAILED', message: 'SFTP timeout on order-api', details: {} },
        { status: 502 },
      ),
    ),
  );
}

function ServersProbe({ silent = false }: { silent?: boolean }) {
  const q = useQuery({
    queryKey: ['servers'],
    queryFn: () => unwrap(api.GET('/api/servers')),
    meta: { silentError: silent },
  });
  return <div>{q.isError ? 'query failed' : 'loading'}</div>;
}

test('failed query shows ApiError.message as a notification', async () => {
  failServers();
  renderWithProviders(<ServersProbe />);
  expect(await screen.findByText('SFTP timeout on order-api')).toBeInTheDocument();
});

test('meta.silentError suppresses the notification', async () => {
  failServers();
  renderWithProviders(<ServersProbe silent />);
  await screen.findByText('query failed');
  expect(screen.queryByText('SFTP timeout on order-api')).not.toBeInTheDocument();
});

test('failed mutation shows the validation message from the API', async () => {
  function AddPrompt() {
    const m = useMutation({
      mutationFn: () =>
        unwrap(
          api.POST('/api/prompts', { body: { name: 'bad', content: 'no placeholder', isDefault: false } }),
        ),
    });
    return <button onClick={() => m.mutate()}>save</button>;
  }
  renderWithProviders(<AddPrompt />);
  await userEvent.click(screen.getByRole('button', { name: 'save' }));
  expect(await screen.findByText('Validation failed')).toBeInTheDocument();
});
