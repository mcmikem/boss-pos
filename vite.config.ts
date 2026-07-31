import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import {browserslistToTargets, transform as lightningcss} from 'lightningcss';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

const LEGACY_CSS_TARGETS = browserslistToTargets(['Android >= 5', 'Chrome >= 49', 'iOS >= 12', 'Safari >= 12']);

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
          file.source = result.code.toString();
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
    plugins: [
      react(),
      tailwindcss(),
      legacy({
        targets: ['Android >= 5', 'Chrome >= 49', 'iOS >= 12', 'Safari >= 12'],
        modernPolyfills: true,
      }),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'IMAC Enterprises POS',
          short_name: 'IMAC POS',
          description: 'Point of Sale system for IMAC Enterprises',
          theme_color: '#0A0A0A',
          background_color: '#0A0A0A',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
          skipWaiting: true,
          clientsClaim: true,
          runtimeCaching: [
            {
              urlPattern: /^https?:\/\/.*/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'external-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 * 7,
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
