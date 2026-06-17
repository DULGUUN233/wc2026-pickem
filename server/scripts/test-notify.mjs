// Notify scheduler-ийн dry-run тест: тусгай тест DB + mock notify endpoint.
// Production өгөгдөл/dedupe key-д огт хүрэхгүй. Ажиллуулах: node server/scripts/test-notify.mjs
import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';

// 1) Тест DB рүү чиглүүлэх
const base = new URL(process.env.MONGODB_URI);
base.pathname = '/wc2026_notify_test';
process.env.MONGODB_URI = base.toString();

// 2) Mock Usion notify endpoint
const SECRET = 'test-secret-1234567890';
const got = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const sig = req.headers['x-wc-signature'] || req.headers['x-usion-signature'];
    const expect = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    got.push({ body: JSON.parse(body), sigOk: sig === expect });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, delivered: 'push' }));
  });
});
await new Promise((r) => mock.listen(4555, r));

process.env.USION_API_URL = 'http://localhost:4555';
process.env.USION_SERVICE_ID = 'svc-test';
process.env.USION_NOTIFY_SECRET = SECRET;

const { connectDb, collections, closeDb, getDb } = await import('../db.js');
const { runTick } = await import('../lib/notify.js');
await connectDb();

// 3) Цэвэрлээд seed: 1 Usion тоглогч, 1 дууссан тоглолтыг яг таг таасан, групп таамаггүй
for (const c of ['players', 'picks', 'matchPicks', 'notifications']) await getDb().collection(c).deleteMany({});
const { insertedId } = await collections.players().insertOne({
  usionId: 'test-usion-1', nickname: 'NotifTest', nicknameLower: 'notiftest', token: 'tok-' + Date.now(), createdAt: new Date(),
});
const pid = String(insertedId);
await collections.matchPicks().insertOne({ playerId: pid, picks: { '537391': { h: 3, a: 1 } }, updatedAt: new Date() }); // FRA 3:1 -> +2

console.log('--- 1-р tick ---');
await runTick();
await new Promise((r) => setTimeout(r, 600));

const byType = (s) => got.filter((g) => g.body.body.includes(s));
console.log('Нийт явсан:', got.length);
console.log('  Дүнгийн (оноо авлаа):', byType('оноо авлаа').length, byType('оноо авлаа')[0]?.body.body || '');
console.log('  Групп сануулга:', byType('Хэсгийн шат').length);
console.log('  Тоглолтын өмнөх:', byType('таамаглаарай').length);
console.log('  Бүх гарын үсэг зөв эсэх:', got.every((g) => g.sigOk));

const after1 = got.length;
console.log('--- 2-р tick (dedupe шалгах) ---');
await runTick();
await new Promise((r) => setTimeout(r, 600));
console.log('2 дахь tick-д шинээр явсан:', got.length - after1, '(0 байх ёстой)');

// 4) Цэвэрлэх (Atlas дээр dropDatabase эрх байхгүй тул collection-оор)
for (const c of ['players', 'picks', 'matchPicks', 'notifications']) await getDb().collection(c).deleteMany({});
await closeDb();
mock.close();
console.log('Тест өгөгдөл цэвэрлэгдлээ. Дууслаа.');
