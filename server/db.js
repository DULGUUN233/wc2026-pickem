import { MongoClient } from 'mongodb';

let client;
let db;
let memoryServer; // зөвхөн MONGODB_URI хоосон үед

/**
 * MongoDB-тэй холбогдоно.
 * - MONGODB_URI байвал тэр рүү холбогдоно (Atlas эсвэл local).
 * - Хоосон бол хөгжүүлэлтэд зориулж санах ойн MongoDB-г асаана (өгөгдөл хадгалагдахгүй).
 */
export async function connectDb() {
  if (db) return db;

  let uri = process.env.MONGODB_URI?.trim();

  if (!uri) {
    try {
      console.warn(
        '\n⚠️  MONGODB_URI тохируулаагүй байна. Хөгжүүлэлтийн санах ойн MongoDB-г асааж байна.\n' +
          '   Өгөгдөл хадгалагдахгүй. Жинхэнэ ашиглалтад .env дотор MONGODB_URI-аа өгнө үү.\n'
      );
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      uri = memoryServer.getUri();
    } catch {
      throw new Error(
        'MONGODB_URI тохируулаагүй байна. Production-д MONGODB_URI өгнө үү. ' +
          '(Локал демонд in-memory ажиллуулах бол: npm i -D mongodb-memory-server)'
      );
    }
  }

  client = new MongoClient(uri);
  await client.connect();
  // URI дотор DB нэр байхгүй бол анхдагчаар wc2026pickem
  const dbNameFromUri = (() => {
    try {
      const path = new URL(uri).pathname.replace(/^\//, '');
      return path || null;
    } catch {
      return null;
    }
  })();
  db = client.db(dbNameFromUri || 'wc2026pickem');

  await ensureIndexes(db);
  console.log(`✅ MongoDB холбогдлоо (db: ${db.databaseName})`);
  return db;
}

async function ensureIndexes(db) {
  await db.collection('players').createIndex({ nicknameLower: 1 }, { unique: true });
  await db.collection('players').createIndex({ token: 1 }, { unique: true });
  await db.collection('players').createIndex({ usionId: 1 }, { unique: true, sparse: true });
  await db.collection('picks').createIndex({ playerId: 1 }, { unique: true });
  await db.collection('leagues').createIndex({ code: 1 }, { unique: true });
  await db.collection('leagues').createIndex({ memberIds: 1 });
}

export function getDb() {
  if (!db) throw new Error('DB холбогдоогүй байна. connectDb()-г эхэлж дуудна уу.');
  return db;
}

export const collections = {
  players: () => getDb().collection('players'),
  picks: () => getDb().collection('picks'),
  leagues: () => getDb().collection('leagues'),
  results: () => getDb().collection('results'),
};

export async function closeDb() {
  await client?.close();
  await memoryServer?.stop();
  db = undefined;
}
