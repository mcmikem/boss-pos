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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    for (const name of [
      'DATABASE_URL', 'AUTH_SECRET', 'CRON_SECRET', 'SUPER_ADMIN_SECRET',
      'APP_TENANT_ID', 'SEED_CATALOG', 'BILLING_BANK_DETAILS',
      'BILLING_MOMO_NAME', 'BILLING_MOMO_NUMBER', 'BILLING_NOTES',
    ]) {
      if (typeof env[name] === 'string') process.env[name] = env[name];
    }
    if (url.pathname.startsWith('/api/') || url.pathname === '/api' || url.pathname.startsWith('/uploads/')) {
      try {
        const handler = await getApiHandler();
        return handler.fetch(request, env, ctx);
      } catch (error) {
        console.error('Boss POS API initialization failed:', error?.message || error);
        return Response.json({ error: 'Service is not configured' }, { status: 503 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
