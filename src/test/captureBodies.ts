import { server } from '../mocks/server';

/** Collects JSON bodies of non-GET requests whose path matches `path`. Listeners are removed after each test. */
export function captureBodies(path: RegExp) {
  const bodies: (Record<string, unknown> | null)[] = []; // null = no body (e.g. POST /confirm)
  server.events.on('request:start', async ({ request }) => {
    if (path.test(new URL(request.url).pathname) && request.method !== 'GET') {
      const text = await request.clone().text();
      bodies.push(text ? JSON.parse(text) : null);
    }
  });
  return bodies;
}
