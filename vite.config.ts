import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import {browserslistToTargets, transform as lightningcss} from 'lightningcss';
import path from 'path';
import postcss, {type Declaration} from 'postcss';
import {execSync} from 'node:child_process';
import {defineConfig, type Plugin} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

const LEGACY_CSS_TARGETS = browserslistToTargets(['Android >= 5', 'Chrome >= 49', 'iOS >= 12', 'Safari >= 12']);

// Commit SHA shown in Settings -> quick truth-test for "am I on the newest
// build?" Any device displaying no "Build" line is stuck on a stale SW cache.
function buildCommit(): string {
  for (const env of ['VERCEL_GIT_COMMIT_SHA', 'RENDER_GIT_COMMIT']) {
    if (process.env[env]) return process.env[env]!;
  }
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
}

const NATIVE_TRANSFORMS = ['translate', 'scale', 'rotate'] as const;

function splitList(v: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (/\s/.test(c) && depth === 0) {
      if (cur) {
        parts.push(cur);
        cur = '';
      }
    } else {
      cur += c;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

function nativeFallback(prop: string, value: string): string {
  const parts = splitList(value);
  if (prop === 'translate') {
    if (parts.length === 1) return `translateX(${parts[0]})`;
    if (parts.length === 2) return `translateX(${parts[0]}) translateY(${parts[1]})`;
    return `translate3d(${parts[0]}, ${parts[1]}, ${parts[2]})`;
  }
  if (prop === 'scale') {
    if (parts.length === 1) return `scale(${parts[0]})`;
    if (parts.length === 2) return `scale(${parts[0]}, ${parts[1]})`;
    return `scale3d(${parts[0]}, ${parts[1]}, ${parts[2]})`;
  }
  if (prop === 'rotate') {
    if (parts.length === 1) return `rotate(${parts[0]})`;
    return `rotate3d(${parts[1]}, ${parts[2]}, ${parts[3]}, ${parts[0]})`;
  }
  return '';
}

// Convert modern logical/inset properties to physical (LTR) equivalents so old
// Android (Chrome < 87) layouts aren't jumbled.
function physical(prop: string, value: string): {prop: string; value: string}[] | null {
  if (value.trim() === 'initial') return null;
  const parts = splitList(value);
  const one = (p: string) => [{prop: p, value: parts[0] ?? value}];
  const two = (a: string, b: string) =>
    parts.length === 1
      ? [{prop: a, value: parts[0]}, {prop: b, value: parts[0]}]
      : [{prop: a, value: parts[0]}, {prop: b, value: parts[1]}];
  switch (prop) {
    case 'inset':
      if (parts.length === 1) return [
        {prop: 'top', value: parts[0]}, {prop: 'right', value: parts[0]},
        {prop: 'bottom', value: parts[0]}, {prop: 'left', value: parts[0]},
      ];
      if (parts.length === 2) return [
        {prop: 'top', value: parts[0]}, {prop: 'right', value: parts[1]},
        {prop: 'bottom', value: parts[0]}, {prop: 'left', value: parts[1]},
      ];
      if (parts.length === 3) return [
        {prop: 'top', value: parts[0]}, {prop: 'right', value: parts[1]},
        {prop: 'bottom', value: parts[2]}, {prop: 'left', value: parts[1]},
      ];
      return [
        {prop: 'top', value: parts[0]}, {prop: 'right', value: parts[1]},
        {prop: 'bottom', value: parts[2]}, {prop: 'left', value: parts[3]},
      ];
    case 'inset-inline': return two('left', 'right');
    case 'inset-inline-start': return one('left');
    case 'inset-inline-end': return one('right');
    case 'inset-block': return two('top', 'bottom');
    case 'inset-block-start': return one('top');
    case 'inset-block-end': return one('bottom');
    case 'margin-inline': return two('margin-left', 'margin-right');
    case 'margin-inline-start': return one('margin-left');
    case 'margin-inline-end': return one('margin-right');
    case 'margin-block': return two('margin-top', 'margin-bottom');
    case 'margin-block-start': return one('margin-top');
    case 'margin-block-end': return one('margin-bottom');
    case 'padding-inline': return two('padding-left', 'padding-right');
    case 'padding-inline-start': return one('padding-left');
    case 'padding-inline-end': return one('padding-right');
    case 'padding-block': return two('padding-top', 'padding-bottom');
    case 'padding-block-start': return one('padding-top');
    case 'padding-block-end': return one('padding-bottom');
  }
  return null;
}

// Downlevel modern CSS features unsupported by old Android:
//  - 4/8-digit alpha hex (lightningcss's color-mix fallback) -> rgba, because
//    Chrome < 62 (Android 5-6 browsers) also drops those as invalid
//  - logical properties (inset/margin/padding inline/block) -> physical
//  - `inset` shorthand -> top/right/bottom/left
//  - native `translate`/`scale`/`rotate` -> `transform` (pure replacement;
//    runs AFTER lightningcss so it can't be merged or re-shortened by it)
function downlevelModern(css: string): string {
  const root = postcss.parse(css);

  // Tailwind v4 emits every opacity modifier (`text-zinc-400/80`, `bg-black/50`,
  // `border-gold-brand/40`, ...) via color-mix. lightningcss already downlevels
  // those to 4/8-digit alpha hex (#0003, #fcbb004d), but Chrome < 62 drops those
  // too — i.e. every old Android this app ships to. Flatten to rgba() (supported
  // since Chrome 49) so old phones render the same tinted design.
  root.walkDecls(decl => {
    decl.value = decl.value.replace(/#([0-9a-fA-F]{4}|[0-9a-fA-F]{8})(?![\w])/g, alphaHexToRgba);
  });

  root.walkRules(rule => {
    const logical: {decl: Declaration; out: {prop: string; value: string}[]}[] = [];
    const natives: {decl: Declaration; prop: string; value: string}[] = [];
    rule.walkDecls(decl => {
      const v = decl.value.trim();
      const ph = physical(decl.prop, v);
      if (ph) {
        logical.push({decl, out: ph});
        return;
      }
      if ((NATIVE_TRANSFORMS as readonly string[]).includes(decl.prop) && v !== 'initial') {
        natives.push({decl, prop: decl.prop, value: v});
      }
    });
    logical.forEach(({decl, out}) => {
      decl.replaceWith(...out.map(o => postcss.decl({prop: o.prop, value: o.value})));
    });
    if (natives.length > 0) {
      const fallback = natives.map(n => nativeFallback(n.prop, n.value)).join(' ');
      const existingTransform = rule.nodes.find((n): n is Declaration => n.type === 'decl' && n.prop === 'transform') || null;
      if (existingTransform) {
        existingTransform.value = existingTransform.value ? `${existingTransform.value} ${fallback}` : fallback;
        natives.forEach(n => n.decl.remove());
      } else {
        natives[0].decl.replaceWith(postcss.decl({prop: 'transform', value: fallback}));
        natives.slice(1).forEach(n => n.decl.remove());
      }
    }
  });
  return root.toString();
}

// #RGBa / #RRGGBBAA -> rgba(), preserving the alpha exactly.
function alphaHexToRgba(hex: string): string {
  const h = hex.length === 5
    ? [...hex.slice(1)].map(ch => ch + ch).join('')
    : hex.slice(1);
  const n = parseInt(h.slice(0, 6), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const a = Math.round((parseInt(h.slice(6, 8), 16) / 255) * 1000) / 1000;
  return `rgba(${r},${g},${b},${a})`;
}

function deLayerCSS(): Plugin {
  return {
    name: 'de-layer-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          const css = convertOklch(deLayer(String(file.source)));
          const result = lightningcss({
            filename: file.fileName,
            code: Buffer.from(css),
            minify: true,
            targets: LEGACY_CSS_TARGETS,
          });
          file.source = downlevelModern(result.code.toString());
        }
      }
    },
  };
}

function convertOklch(css: string): string {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    if (css.startsWith('oklch(', i)) {
      let j = i + 6;
      let depth = 1;
      while (j < n && depth > 0) {
        if (css[j] === '(') depth++;
        else if (css[j] === ')') depth--;
        if (depth > 0) j++;
      }
      const inner = css.slice(i + 6, j);
      const m = inner.match(/^\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*$/);
      if (m) {
        out += oklchToRgb(parseNum(m[1]), parseNum(m[2], 0.4), parseFloat(m[3]), m[4]);
        i = j + 1;
        continue;
      }
    }
    out += css[i];
    i++;
  }
  return out;
}

function parseNum(s: string, percentOf = 1): number {
  return s.endsWith('%') ? (parseFloat(s) / 100) * percentOf : parseFloat(s);
}

function oklchToRgb(L: number, C: number, H: number, alphaStr?: string): string {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  let l = L + 0.3963377774 * a + 0.2158037573 * b;
  let m = L - 0.1055613458 * a - 0.0638541728 * b;
  let s = L - 0.0894841775 * a - 1.291485548 * b;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const gamma = (c: number) => {
    c = Math.min(1, Math.max(0, c));
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  r = Math.round(gamma(r) * 255);
  g = Math.round(gamma(g) * 255);
  bl = Math.round(gamma(bl) * 255);
  if (alphaStr) {
    return `rgba(${r},${g},${bl},${parseNum(alphaStr)})`;
  }
  return `rgb(${r},${g},${bl})`;
}

function deLayer(css: string): string {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const commentEnd = end === -1 ? n : end + 2;
      out += css.slice(i, commentEnd);
      i = commentEnd;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (css[j] === '\\') {
          j += 2;
          continue;
        }
        if (css[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += css.slice(i, j);
      i = j;
      continue;
    }
    if (css.startsWith('@layer', i)) {
      const after = i + 6;
      const boundary = css[after];
      if (boundary === ' ' || boundary === '\t' || boundary === '\n' || boundary === '\r' || boundary === '{' || boundary === ',') {
        let j = after;
        while (j < n) {
          const c = css[j];
          if (c === '{') {
            let depth = 1;
            let k = j + 1;
            while (k < n && depth > 0) {
              const kc = css[k];
              if (kc === '{') {
                depth++;
              } else if (kc === '}') {
                depth--;
                if (depth === 0) {
                  out += css.slice(j + 1, k);
                  i = k + 1;
                  break;
                }
              } else if (kc === '"' || kc === "'") {
                const q = kc;
                let m = k + 1;
                while (m < n) {
                  if (css[m] === '\\') {
                    m += 2;
                    continue;
                  }
                  if (css[m] === q) {
                    m += 1;
                    break;
                  }
                  m += 1;
                }
                k = m;
                continue;
              } else if (kc === '/' && css[k + 1] === '*') {
                const ce = css.indexOf('*/', k + 2);
                k = ce === -1 ? n : ce + 2;
                continue;
              }
              k += 1;
            }
            break;
          } else if (c === ';') {
            i = j + 1;
            break;
          } else {
            j += 1;
          }
        }
        if (j >= n) i = n;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

export default defineConfig(() => {
  return {
    define: {
      // Exposed in Settings as "Build: <short sha>" so a support session can
      // immediately tell whether a phone is running the newest build or a
      // stale service-worker cache (the #1 reason "it still crashes").
      __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    },
    plugins: [
      react(),
      tailwindcss(),
      legacy({
        targets: ['Android >= 5', 'Chrome >= 49', 'iOS >= 12', 'Safari >= 12'],
        modernPolyfills: true,
        // Chrome 64+ side of the two-tier split. ES-module-capable old WebViews
        // (Android 7-8, and Android 9 unless its WebView was updated) load the
        // modern bundle, so it must stay below optional-chaining/class-field
        // syntax. Pin explicitly so a plugin default bump can't silently break
        // Android 9. Browsers below this get the legacy bundle above.
        modernTargets: ['chrome >= 64', 'chromeAndroid >= 64', 'edge >= 79', 'firefox >= 67', 'safari >= 12', 'ios_saf >= 12'],
      }),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'pwa-192x192.png', 'pwa-512x512.png', 'apple-touch-icon.png', 'maskable-512x512.png'],
        manifest: {
          // Build-time brand, set by the fleet provisioner per shop (e.g.
          // VITE_APP_NAME="Katwe Hardware" in that project's build env).
          // Unset -> current IMAC branding unchanged.
          name: process.env.VITE_APP_NAME ? `${process.env.VITE_APP_NAME} POS` : 'IMAC Enterprises POS',
          short_name: process.env.VITE_APP_NAME || 'IMAC POS',
          description: process.env.VITE_APP_NAME ? `Point of Sale system for ${process.env.VITE_APP_NAME}` : 'Point of Sale system for IMAC Enterprises',
          theme_color: '#0A0A0A',
          background_color: '#0A0A0A',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          navigateFallback: 'index.html',
          runtimeCaching: [
            // Product photos are immutable public assets — CacheFirst means the
            // till serves them instantly from the SW after the first fetch, so
            // product grids don't re-download thumbnails on every boot.
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/uploads/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'uploads-cache',
                expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: /^https?:\/\/.*/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'external-cache',
                // Don't let a flaky 3G link hang the UI — fall back to cache
                // after 5s and refresh in the background.
                networkTimeoutSeconds: 5,
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
              },
            },
          ],
        },
      }),
      deLayerCSS(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 600,
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
