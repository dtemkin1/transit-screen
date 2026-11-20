import type { ClientInit, HandleClientError } from '@sveltejs/kit/hooks';
import { dev } from '$app/env';
import { WORKER_URL } from '$app/env/public';
import { reportError } from '#lib/data/worker-client.ts';

// Screens run unattended, so errors nobody handled are sent to the Worker's logs. On the dev
// server they stay in the console.
const send = (error: unknown) => {
  if (!dev) reportError({ workerUrl: WORKER_URL }, error);
};

export const init: ClientInit = () => {
  // Only events carrying an error: the browser's "ResizeObserver loop completed" notice has none,
  // and means only that `fit` and `shrinkToFit` resized something a frame later.
  addEventListener('error', (e) => {
    if (e.error) send(e.error);
  });
  addEventListener('unhandledrejection', (e) => send(e.reason));
};

/** Errors SvelteKit catches while starting or navigating; the default error page still shows. */
export const handleError: HandleClientError = ({ error }) => {
  send(error);
};
