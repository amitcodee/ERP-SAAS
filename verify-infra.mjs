import pg from "pg";
import Redis from "ioredis";

const dbUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

const client = new pg.Client({ connectionString: dbUrl });
try {
  await client.connect();
  const res = await client.query("select version()");
  console.log("POSTGRES OK:", res.rows[0].version);
} catch (e) {
  console.error("POSTGRES FAIL:", e.message);
} finally {
  await client.end();
}

const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 5000 });
try {
  const pong = await redis.ping();
  console.log("REDIS OK:", pong);
} catch (e) {
  console.error("REDIS FAIL:", e.message);
} finally {
  redis.disconnect();
}
