import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** MSW for Vitest (Node). Started in src/test/setup.ts. */
export const server = setupServer(...handlers);
