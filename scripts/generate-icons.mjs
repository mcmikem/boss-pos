// Renders PWA install icons from public/icon.svg with sharp.
// Run: npm run icons   (only needed when the source SVG changes)
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(__dirname, '..', 'public', 'icon.svg'));
const out = (name) => join(__dirname, '..', 'public', name);

// "Any" purpose icons: the full rounded design.
await sharp(svg, { density: 300 }).resize(192, 192).png().toFile(out('pwa-192x192.png'));
await sharp(svg, { density: 300 }).resize(512, 512).png().toFile(out('pwa-512x512.png'));
// iOS home-screen icon (no transparency, no rounded corners — iOS rounds it).
await sharp(svg, { density: 300 })
  .resize(180, 180)
  .flatten({ background: '#0A0A0A' })
  .png()
  .toFile(out('apple-touch-icon.png'));
// Maskable: scale the design to the 80% safe zone on a full-bleed background so
// launchers of every shape crop cleanly.
await sharp({
  create: { width: 512, height: 512, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
})
  .composite([
    {
      input: await sharp(svg, { density: 300 }).resize(410, 410).png().toBuffer(),
      left: 51,
      top: 51,
    },
  ])
  .png()
  .toFile(out('maskable-512x512.png'));

console.log('Icons generated: pwa-192x192.png, pwa-512x512.png, apple-touch-icon.png, maskable-512x512.png');
