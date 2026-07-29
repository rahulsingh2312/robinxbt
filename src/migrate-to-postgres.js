// One-shot copy of the JSON store into PostgreSQL. Idempotent: rows are
// upserted, so a re-run after a partial failure is safe. The JSON file is
// left untouched as a fallback until the operator deletes it.
import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { PostgresStore } from "./postgres-store.js";

const config = loadConfig();
if (!config.databaseUrl) throw new Error("Set DATABASE_URL before migrating");

const raw = JSON.parse(await readFile(config.dataFile, "utf8"));
const store = new PostgresStore(config.databaseUrl);
await store.load();

const counts = { wallets: 0, users: 0, paper: 0, state: 0, spend: 0 };

for (const [key, record] of Object.entries(raw.wallets ?? {})) {
  const [botUsername, authorId] = splitKey(key);
  await store.setWallet(botUsername, authorId, record);
  counts.wallets += 1;
}
for (const [key, user] of Object.entries(raw.users ?? {})) {
  const [botUsername, xUsername] = splitKey(key);
  await store.setUser(botUsername, xUsername, user);
  counts.users += 1;
}
for (const [key, book] of Object.entries(raw.paper ?? {})) {
  const [botUsername, userId] = splitKey(key);
  await store.setPaperBook(botUsername, userId, book);
  counts.paper += 1;
}
for (const [botUsername, state] of Object.entries(raw.state ?? {})) {
  if (state?.lastMentionId) {
    await store.setLastMentionId(botUsername, state.lastMentionId);
    counts.state += 1;
  }
}
for (const [key, amount] of Object.entries(raw.spend ?? {})) {
  const [botUsername, day] = splitKey(key);
  await store.recordSpend(botUsername, day, Number(amount));
  counts.spend += 1;
}

console.info(`Migrated ${counts.wallets} wallet(s), ${counts.users} user(s), ${counts.paper} paper book(s), ${counts.state} cursor(s), ${counts.spend} spend row(s).`);
await store.close();

// Keys are "bot:rest", and the rest may itself contain colons.
function splitKey(key) {
  const at = key.indexOf(":");
  return [key.slice(0, at), key.slice(at + 1)];
}
