// MongoDB-д аппын collection + индексүүдийг үүсгэнэ.
// Ажиллуулах:  node server/setup-db.js
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const COLLECTIONS = ['players', 'picks', 'leagues', 'results'];

const uri = process.env.MONGODB_URI?.trim();
if (!uri) {
  console.error('❌ MONGODB_URI .env дотор алга.');
  process.exit(1);
}

const dbName = (() => {
  try {
    return new URL(uri).pathname.replace(/^\//, '') || 'wc2026pickem';
  } catch {
    return 'wc2026pickem';
  }
})();

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });

try {
  await client.connect();
  await client.db('admin').command({ ping: 1 });
  const db = client.db(dbName);
  console.log(`✅ Холбогдлоо. DB: ${dbName}`);

  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
      console.log(`  + collection үүсгэв: ${name}`);
    } catch (e) {
      if (e.codeName === 'NamespaceExists' || e.code === 48) {
        console.log(`  = collection аль хэдийн байна: ${name}`);
      } else {
        throw e;
      }
    }
  }

  // Индексүүд
  await db.collection('players').createIndex({ nicknameLower: 1 }, { unique: true });
  await db.collection('players').createIndex({ token: 1 }, { unique: true });
  await db.collection('picks').createIndex({ playerId: 1 }, { unique: true });
  await db.collection('leagues').createIndex({ code: 1 }, { unique: true });
  await db.collection('leagues').createIndex({ memberIds: 1 });
  console.log('  ✓ индексүүд тавигдлаа');

  const cols = await db.listCollections().toArray();
  console.log('\n📋 DB доторх collection-ууд:');
  for (const c of cols) {
    const count = await db.collection(c.name).countDocuments();
    console.log(`   - ${c.name} (${count} баримт)`);
  }
  console.log('\n🎉 Бэлэн боллоо!');
} catch (err) {
  console.error('❌ Алдаа:', err.message);
  if (/IP|whitelist|not allowed|timed out|ECONNREFUSED|querySrv|ENOTFOUND/i.test(err.message)) {
    console.error(
      '\n👉 Магадгүй Atlas-ийн IP allowlist. Atlas → Network Access → ' +
        'Add IP Address → "Allow access from anywhere" (0.0.0.0/0) тавиад дахин оролд.'
    );
  }
  process.exitCode = 1;
} finally {
  await client.close();
}
