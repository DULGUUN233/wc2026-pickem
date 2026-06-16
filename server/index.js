import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDb, closeDb } from './db.js';
import apiRouter from './routes/api.js';
import { HttpError } from './lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json({ limit: '256kb' }));

app.use('/api', apiRouter);

// Static frontend
app.use(express.static(PUBLIC_DIR));

// Алдаа барих
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  // Давхар нэр/код гэх мэт unique index зөрчил
  if (err?.code === 11000) {
    return res.status(409).json({ error: 'Давхцсан утга байна' });
  }
  console.error(err);
  res.status(500).json({ error: 'Серверийн алдаа' });
});

const PORT = process.env.PORT || 3000;

connectDb()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`🏆 WC2026 Pick'em ажиллаж байна: http://localhost:${PORT}`);
    });
    const shutdown = async () => {
      console.log('\nХаагдаж байна...');
      server.close();
      await closeDb();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((err) => {
    console.error('Эхлэхэд алдаа гарлаа:', err);
    process.exit(1);
  });
