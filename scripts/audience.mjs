// Who has mentioned this account, and how often.
//
//   node --env-file=.env scripts/audience.mjs            # table to stdout
//   node --env-file=.env scripts/audience.mjs --csv      # csv to stdout
//   node --env-file=.env scripts/audience.mjs --pages 10 # read further back
//
// READ ONLY. This script has no posting path — it imports nothing that can
// write to X and never constructs a reply. It answers "who talks to me", which
// is a question about your own audience, not a mailing list.
//
// On reach: X's mentions timeline is a rolling window, not an archive. Depending
// on access level it returns roughly the last 800 mentions or the last 7 days,
// whichever runs out first. There is no "everyone who ever tagged me" endpoint
// below full-archive search, so treat this as "recent audience", not "all time".
import { authorizationHeader } from "../src/oauth1.js";

const API = "https://api.x.com/2";

const args = process.argv.slice(2);
const asCsv = args.includes("--csv");
const maxPages = Number(args[args.indexOf("--pages") + 1]) || 5;

const credentials = {
  consumerKey: process.env.X_CONSUMER_KEY ?? "",
  consumerSecret: process.env.X_CONSUMER_SECRET ?? "",
  accessToken: process.env.X_ACCESS_TOKEN ?? "",
  accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET ?? ""
};
if (Object.values(credentials).some((value) => !value)) {
  console.error("Missing X OAuth 1.0a credentials. Run with --env-file=.env");
  process.exit(1);
}

// The numeric ID is the prefix of the access token, so it never has to be
// configured separately and cannot disagree with the credentials in use.
const botUserId = credentials.accessToken.match(/^(\d+)-/)?.[1];
if (!botUserId) {
  console.error("Could not derive the account ID from X_ACCESS_TOKEN.");
  process.exit(1);
}

async function get(url) {
  const response = await fetch(url, {
    headers: { authorization: authorizationHeader({ method: "GET", url: url.toString(), credentials }) },
    signal: AbortSignal.timeout(15_000)
  });
  if (response.status === 429) {
    const reset = Number(response.headers.get("x-rate-limit-reset")) * 1000;
    const waitMs = Math.max(0, reset - Date.now());
    throw new Error(`rate limited; resets in ${Math.ceil(waitMs / 1000)}s`);
  }
  if (!response.ok) throw new Error(`X ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

const authors = new Map();
let token;
let pages = 0;
let mentions = 0;

while (pages < maxPages) {
  const url = new URL(`${API}/users/${botUserId}/mentions`);
  url.searchParams.set("max_results", "100");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username,name,public_metrics,verified");
  url.searchParams.set("tweet.fields", "created_at");
  if (token) url.searchParams.set("pagination_token", token);

  let body;
  try {
    body = await get(url);
  } catch (error) {
    // Partial data still answers the question; stopping loudly beats an empty
    // table with no explanation of why.
    console.error(`Stopped early after ${pages} page(s): ${error.message}`);
    break;
  }

  const users = new Map((body.includes?.users ?? []).map((user) => [user.id, user]));
  for (const post of body.data ?? []) {
    mentions += 1;
    const user = users.get(post.author_id);
    if (!user) continue;
    const entry = authors.get(user.id) ?? {
      username: user.username,
      name: user.name,
      followers: user.public_metrics?.followers_count ?? 0,
      count: 0,
      first: post.created_at,
      last: post.created_at
    };
    entry.count += 1;
    if (post.created_at) {
      if (!entry.first || post.created_at < entry.first) entry.first = post.created_at;
      if (!entry.last || post.created_at > entry.last) entry.last = post.created_at;
    }
    authors.set(user.id, entry);
  }

  pages += 1;
  token = body.meta?.next_token;
  if (!token) break;
}

const ranked = [...authors.values()].sort((a, b) => b.count - a.count || b.followers - a.followers);

if (asCsv) {
  console.log("username,name,mentions,followers,first_seen,last_seen");
  for (const a of ranked) {
    const name = `"${String(a.name).replace(/"/g, '""')}"`;
    console.log(`${a.username},${name},${a.count},${a.followers},${a.first ?? ""},${a.last ?? ""}`);
  }
} else {
  console.log(`\n${mentions} mentions from ${ranked.length} distinct accounts (${pages} page(s) read)\n`);
  console.log("  MENTIONS  FOLLOWERS  ACCOUNT");
  console.log("  " + "-".repeat(58));
  for (const a of ranked.slice(0, 40)) {
    console.log(
      "  " + String(a.count).padStart(8) +
      String(a.followers).padStart(11) + "  @" + a.username +
      (a.count > 1 ? "" : "")
    );
  }
  if (ranked.length > 40) console.log(`\n  …and ${ranked.length - 40} more. Use --csv for the full list.`);
  console.log("");
}
