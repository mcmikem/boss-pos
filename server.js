import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import app from './api/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;

// In dev mode, only handle API — Vite serves the frontend
if (process.env.API_ONLY) {
  console.log(`\n  🏪 IMAC API server on port ${PORT}\n`);
} else {
  app.use(express.static(join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🏪 IMAC POS is LIVE at:`);
  console.log(`  ➜  Local:   http://localhost:${PORT}/`);
  console.log(`  ➜  Network: http://192.168.1.3:${PORT}/`);
  console.log(`  ➜  Any device on same WiFi can access the Network URL\n`);
});
