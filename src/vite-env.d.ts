/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" → MSW serves the API from src/mocks (see .env.mock). */
  readonly VITE_USE_MOCKS?: string;
}
