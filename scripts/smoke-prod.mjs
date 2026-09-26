// Production smoke test: proves the live deployment answers, guards its
// endpoints, and serves the app shell. Run: npm run smoke[:prod]
// Exits nonzero on the first failure so CI or a human gets a clear verdict.
const base = (process.env.PROD_URL || 'https://imac-pos.vercel.app').replace(/\/+$/, '');

let failures = 0;

async function check(name, path, want, validate) {
  const url = base + path;
  try {
    const res = await fetch(url, { redirect: 'manual' });
    const statusOk = res.status === want;
    let bodyOk = true;
    let detail = '';
    if (validate) {
      const text = await res.text();
      const result = validate(text, res);
      bodyOk = result.ok;
      detail = result.detail || '';
    }
    if (statusOk && bodyOk) {
      console.log(`ok   ${name} (${path} -> ${res.status})${detail ? ` ${detail}` : ''}`);
    } else {
      failures += 1;
      console.error(`FAIL ${name} (${path} -> ${res.status}, want ${want})${detail ? ` ${detail}` : ''}`);
    }
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${name} (${path}): ${err?.message || err}`);
  }
}

const isJson = (text) => {
  try { return { ok: true, parsed: JSON.parse(text) }; }
  catch { return { ok: false }; }
};

const short = process.env.EXPECT_BUILD || '';

await check('health', '/api/health', 200, (text) => {
  const { ok, parsed } = isJson(text);
  if (!ok || parsed?.status !== 'ok') return { ok: false, detail: 'bad body' };
  if (short && parsed?.build !== short) return { ok: false, detail: `build ${parsed?.build}, want ${short}` };
  return { ok: true, detail: `build ${parsed?.build}` };
});

await check('readiness', '/api/ready', 200, (text) => {
  const { ok, parsed } = isJson(text);
  if (!ok || parsed?.status !== 'ready') return { ok: false, detail: 'bad body' };
  if (!parsed?.database?.ok) return { ok: false, detail: 'database not ok' };
  return { ok: true, detail: `db ${parsed.database.latencyMs}ms` };
});

await check('version', '/api/version', 200, (text) => {
  const { ok, parsed } = isJson(text);
  if (!ok || !parsed?.short) return { ok: false, detail: 'bad body' };
  if (short && parsed?.short !== short) return { ok: false, detail: `short ${parsed?.short}, want ${short}` };
  return { ok: true, detail: `short ${parsed?.short}` };
});

await check('lock-screen status', '/api/auth/status', 200, (text) => {
  const { ok, parsed } = isJson(text);
  if (!ok || typeof parsed?.hasPin !== 'boolean') return { ok: false, detail: 'bad body' };
  return { ok: true, detail: `shop ${parsed?.shopName || '?'} pin:${parsed?.hasPin ? 'yes' : 'no'}` };
});

await check('boot requires auth', '/api/boot', 401, (text) => {
  const { ok, parsed } = isJson(text);
  return parsed && parsed?.code === 'AUTH_REQUIRED' ? { ok: true } : { ok, detail: 'wrong error shape' };
});

await check('manager surface requires auth', '/api/money-handover/summary', 401);

await check('app shell', '/', 200, (text, res) => {
  const ctype = res.headers.get('content-type') || '';
  if (!/html/.test(ctype)) return { ok: false, detail: `content-type ${ctype}` };
  if (!/\/assets\/index-[^"]+\.js/.test(text)) return { ok: false, detail: 'no entry script' };
  return { ok: true };
});

await check('service worker', '/sw.js', 200, (text, res) => {
  const ctype = res.headers.get('content-type') || '';
  return /javascript/.test(ctype) ? { ok: true } : { ok: false, detail: `content-type ${ctype}` };
});

await check('pwa manifest', '/manifest.webmanifest', 200);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed against ${base}`);
  process.exit(1);
}
console.log(`\nAll checks passed against ${base}`);
