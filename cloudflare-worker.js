import { httpServerHandler } from 'cloudflare:node';

let apiHandlerPromise;

async function getApiHandler() {
  if (!apiHandlerPromise) {
    apiHandlerPromise = (async () => {
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is not configured for this Worker');
      }
      const { default: app } = await import('./api/index.js');
      app.listen(8787);
      return httpServerHandler({ port: 8787 });
    })();
  }
  return apiHandlerPromise;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/api' || url.pathname.startsWith('/uploads/')) {
      // Express reads its configuration through process.env during module
      // initialization. Copy Worker bindings first so secrets are available
      // even when the runtime has not populated process.env automatically.
      for (const [name, value] of Object.entries(env)) {
        if (typeof value === 'string') process.env[name] = value;
      }
      try {
        const handler = await getApiHandler();
        return handler(request);
      } catch (error) {
        console.error('Boss POS API initialization failed:', error?.message || error);
        return Response.json({ error: 'Service is not configured' }, { status: 503 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
