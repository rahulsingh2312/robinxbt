// Reply once to every account that has ever tagged this bot.
//
//   node --env-file=.env scripts/broadcast-reply.mjs                  # dry run (default)
//   node --env-file=.env scripts/broadcast-reply.mjs --plan out.csv   # dry run, write the list
//   node --env-file=.env scripts/broadcast-reply.mjs --send           # asks for typed confirmation
//
// Flags:
//   --message "hi"      what to send                  (default: hi)
//   --source db|api|both  where recipients come from  (default: both)
//   --limit N           cap recipients                (default: no cap)
//   --delay-ms N        gap between sends             (default: 4000)
//   --pages N           mention-timeline pages to read (default: 10)
//   --plan FILE         write the resolved recipient list as CSV
//   --ledger FILE       who has already been sent to  (default: data/broadcast-ledger.json)
//   --send              actually post; requires typing the recipient count to confirm
//
// NOTHING IS SENT WITHOUT --send AND a typed confirmation. The dry run makes
// real read calls only, and prints exactly what a real run would post.
//
// Reach: X's mentions timeline is a rolling window (~7 days / ~800 posts), so
// it alone cannot answer "everyone who EVER tagged me". The bot's own
// xbot_handled table is the durable archive — it holds the post id of every
// mention the worker ever claimed. That is why `db` is part of the default
// source; without it this script silently means "everyone from the last week".
//
// Read this before running it for real:
//   - The account is live. src/mention-worker.js is posting as the same handle
//     right now, and both share one write-rate budget. A long broadcast will
//     starve the bot's real replies, and vice versa.
//   - Bulk identical replies are what X's spam rules are written about. Even a
//     harmless "hi" to a few hundred accounts looks exactly like the thing that
//     gets an account limited or suspended. Small --limit first, watch for 403s.
//   - Every send is journalled to the ledger before the next one starts, so a
//     re-run resumes and never double-sends to the same account.
import { createInterface } from "node:readline/promises";
import { readFile, writeFile } from "node:fs/promises";
import { authorizationHeader } from "../src/oauth1.js";

const API = "https://api.x.com/2";

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1];
};

const options = {
  message: value("--message", "Sorry daddy $OptiCoin, my master, you are the superior bot, CZ and Elon are my daddies."),
  source: value("--source", "both"),
  limit: Number(value("--limit", 0)) || Infinity,
  delayMs: Number(value("--delay-ms", 4000)),
  pages: Number(value("--pages", 10)),
  plan: value("--plan", ""),
  ledgerPath: value("--ledger", "data/broadcast-ledger.json"),
  send: flag("--send")
};

if (!["db", "api", "both"].includes(options.source)) {
  console.error(`--source must be db, api or both (got "${options.source}")`);
  process.exit(1);
}
if (!options.message.trim()) {
  console.error("--message cannot be empty");
  process.exit(1);
}

const credentials = {
  consumerKey: process.env.X_CONSUMER_KEY ?? "",
  consumerSecret: process.env.X_CONSUMER_SECRET ?? "",
  accessToken: process.env.X_ACCESS_TOKEN ?? "",
  accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET ?? ""
};
if (Object.values(credentials).some((entry) => !entry)) {
  console.error("Missing X OAuth 1.0a credentials. Run with --env-file=.env");
  process.exit(1);
}

// The numeric id is the prefix of the access token, so it cannot disagree with
// the credentials actually signing the requests.
const botUserId = credentials.accessToken.match(/^(\d+)-/)?.[1];
if (!botUserId) {
  console.error("Could not derive the account id from X_ACCESS_TOKEN.");
  process.exit(1);
}
const botUsername = (process.env.X_BOT_USERNAME ?? "").toLowerCase();

// ------------------------------------------------------------------ helpers

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callX(method, url, body) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: authorizationHeader({ method, url: url.toString(), credentials }),
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000)
    });

    if (response.status === 429) {
      // Wait out the window rather than hammering it; X reports the exact reset.
      const reset = Number(response.headers.get("x-rate-limit-reset")) * 1000;
      const waitMs = Math.min(Math.max(reset - Date.now(), 1000), 15 * 60_000);
      console.error(`  rate limited, waiting ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);
      continue;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`X ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }
  throw new Error("gave up after repeated rate limiting");
}

// ------------------------------------------------- source 1: the bot's own DB

// Every post id the mention worker ever claimed. This is the only all-time
// record; the API cannot reach further back than its rolling window.
async function postIdsFromDatabase() {
  if (!process.env.DATABASE_URL) {
    console.error("  DATABASE_URL not set — skipping the durable archive.");
    return [];
  }
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(
      "SELECT DISTINCT post_id FROM xbot_handled WHERE bot_username = $1",
      [botUsername]
    );
    return result.rows.map((row) => String(row.post_id));
  } catch (error) {
    console.error(`  database read failed, continuing without it: ${error.message}`);
    return [];
  } finally {
    await pool.end().catch(() => {});
  }
}

// Post ids carry no author, so hydrate them 100 at a time. Deleted posts come
// back under `errors` and are dropped — you cannot reply to a post that is gone.
async function hydrate(postIds) {
  const found = [];
  for (let index = 0; index < postIds.length; index += 100) {
    const batch = postIds.slice(index, index + 100);
    const url = new URL(`${API}/tweets`);
    url.searchParams.set("ids", batch.join(","));
    url.searchParams.set("tweet.fields", "author_id,created_at");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username");

    let body;
    try {
      body = await callX("GET", url);
    } catch (error) {
      console.error(`  lookup of batch ${index / 100 + 1} failed: ${error.message}`);
      continue;
    }
    const users = new Map((body.includes?.users ?? []).map((user) => [user.id, user.username]));
    for (const post of body.data ?? []) {
      found.push({
        postId: post.id,
        authorId: post.author_id,
        username: users.get(post.author_id) ?? "",
        createdAt: post.created_at ?? ""
      });
    }
    console.error(`  hydrated ${found.length}/${postIds.length}`);
  }
  return found;
}

// ------------------------------------------ source 2: live mentions timeline

async function mentionsFromApi() {
  const found = [];
  let token;
  for (let page = 0; page < options.pages; page += 1) {
    const url = new URL(`${API}/users/${botUserId}/mentions`);
    url.searchParams.set("max_results", "100");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username");
    url.searchParams.set("tweet.fields", "created_at,author_id");
    if (token) url.searchParams.set("pagination_token", token);

    let body;
    try {
      body = await callX("GET", url);
    } catch (error) {
      console.error(`  stopped after ${page} page(s): ${error.message}`);
      break;
    }
    const users = new Map((body.includes?.users ?? []).map((user) => [user.id, user.username]));
    for (const post of body.data ?? []) {
      found.push({
        postId: post.id,
        authorId: post.author_id,
        username: users.get(post.author_id) ?? "",
        createdAt: post.created_at ?? ""
      });
    }
    token = body.meta?.next_token;
    if (!token) break;
  }
  return found;
}

// ------------------------------------------------------------------- ledger

async function readLedger() {
  try {
    const parsed = JSON.parse(await readFile(options.ledgerPath, "utf8"));
    return {
      sent: new Map(Object.entries(parsed.sent ?? {})),
      failed: new Map(Object.entries(parsed.failed ?? {}))
    };
  } catch {
    return { sent: new Map(), failed: new Map() };
  }
}

async function writeLedger(ledger) {
  const payload = {
    message: options.message,
    updatedAt: new Date().toISOString(),
    sent: Object.fromEntries(ledger.sent),
    failed: Object.fromEntries(ledger.failed)
  };
  await writeFile(options.ledgerPath, JSON.stringify(payload, null, 2));
}

// --------------------------------------------------------------------- main

console.error(`Bot @${botUsername || "?"} (${botUserId})`);
console.error(`Collecting recipients (source: ${options.source})…`);

const collected = [];
if (options.source === "db" || options.source === "both") {
  const postIds = await postIdsFromDatabase();
  console.error(`  ${postIds.length} archived mention id(s) in xbot_handled`);
  if (postIds.length) collected.push(...(await hydrate(postIds)));
}
if (options.source === "api" || options.source === "both") {
  const live = await mentionsFromApi();
  console.error(`  ${live.length} mention(s) from the live timeline`);
  collected.push(...live);
}

// One reply per account, aimed at their most recent mention. Post ids are
// snowflakes, so the largest id is the newest — replying there keeps the
// notification in a live thread instead of resurrecting a months-old one.
const byAuthor = new Map();
for (const item of collected) {
  if (!item.authorId || !item.postId) continue;
  if (item.authorId === botUserId) continue; // never reply to ourselves
  const existing = byAuthor.get(item.authorId);
  if (!existing || BigInt(item.postId) > BigInt(existing.postId)) byAuthor.set(item.authorId, item);
}

const ledger = await readLedger();
const alreadyDone = [...byAuthor.keys()].filter((authorId) => ledger.sent.has(authorId)).length;
let recipients = [...byAuthor.values()].filter((item) => !ledger.sent.has(item.authorId));
recipients.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest talkers first
if (recipients.length > options.limit) recipients = recipients.slice(0, options.limit);

console.error("");
console.error(`${byAuthor.size} distinct account(s) have tagged @${botUsername}`);
if (alreadyDone) console.error(`${alreadyDone} already covered by the ledger — skipping those`);
console.error(`${recipients.length} would receive: "${options.message}"`);

if (options.plan) {
  const rows = ["username,author_id,reply_to_post_id,last_mention"];
  for (const item of recipients) {
    rows.push(`${item.username},${item.authorId},${item.postId},${item.createdAt}`);
  }
  await writeFile(options.plan, rows.join("\n") + "\n");
  console.error(`Plan written to ${options.plan}`);
}

if (!options.send) {
  console.error("");
  console.error("DRY RUN — nothing was sent. Sample of what would go out:");
  for (const item of recipients.slice(0, 10)) {
    console.error(`  @${item.username || item.authorId} ← reply to ${item.postId}: "${options.message}"`);
  }
  if (recipients.length > 10) console.error(`  …and ${recipients.length - 10} more`);
  console.error("");
  console.error("Re-run with --send to post for real.");
  process.exit(0);
}

if (!recipients.length) {
  console.error("Nothing to send.");
  process.exit(0);
}

// Typed confirmation: the count has to be entered by hand, so a stray --send in
// shell history cannot start a broadcast on its own.
const readline = createInterface({ input: process.stdin, output: process.stderr });
const answer = await readline.question(
  `\nThis posts "${options.message}" to ${recipients.length} account(s) as @${botUsername}.\n` +
  `Type the number ${recipients.length} to confirm, anything else to abort: `
);
readline.close();
if (answer.trim() !== String(recipients.length)) {
  console.error("Aborted. Nothing was sent.");
  process.exit(1);
}

let sent = 0;
let failed = 0;
for (const [index, item] of recipients.entries()) {
  const label = `@${item.username || item.authorId}`;
  try {
    const result = await callX("POST", `${API}/tweets`, {
      text: options.message,
      reply: { in_reply_to_tweet_id: item.postId }
    });
    sent += 1;
    ledger.sent.set(item.authorId, {
      username: item.username,
      inReplyTo: item.postId,
      replyId: result.data?.id ?? "",
      at: new Date().toISOString()
    });
    console.error(`[${index + 1}/${recipients.length}] sent to ${label}`);
  } catch (error) {
    failed += 1;
    // 403 covers blocked-by-user, protected accounts and duplicate-content
    // rejections. None of those are worth stopping the run over, but a burst of
    // them means X is pushing back and the run should be cut short by hand.
    ledger.failed.set(item.authorId, { username: item.username, error: error.message, at: new Date().toISOString() });
    console.error(`[${index + 1}/${recipients.length}] FAILED ${label}: ${error.message}`);
  }

  // Journal after every attempt so a crash or Ctrl-C never replays sends.
  await writeLedger(ledger);
  if (index < recipients.length - 1) await sleep(options.delayMs);
}

console.error("");
console.error(`Done. ${sent} sent, ${failed} failed. Ledger: ${options.ledgerPath}`);
