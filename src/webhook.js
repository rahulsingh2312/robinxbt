import { createHmac, timingSafeEqual } from "node:crypto";

// X proves it controls the connection with a periodic Challenge-Response Check
// (GET ?crc_token=...) and signs every event POST. Both use HMAC-SHA256 keyed
// with the app's consumer secret, so a webhook is only as safe as that secret.
export function crcResponse(crcToken, consumerSecret) {
  return { response_token: `sha256=${hmac(crcToken, consumerSecret)}` };
}

export function verifySignature(rawBody, header, consumerSecret) {
  if (!header) return false;
  const expected = `sha256=${hmac(rawBody, consumerSecret)}`;
  const provided = Buffer.from(header);
  const computed = Buffer.from(expected);
  return provided.length === computed.length && timingSafeEqual(provided, computed);
}

function hmac(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64");
}

// The v2 Activity API payload shape is not fully documented, so posts are
// extracted defensively from the shapes X has used rather than one fixed path.
export function extractMentions(payload) {
  const posts = [];
  const users = new Map();

  for (const user of payload?.includes?.users ?? []) users.set(user.id, user.username);
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (!Array.isArray(value)) continue;
    // v1-style envelopes used keys like `tweet_create_events`.
    if (/tweet_create_events|post_create_events|events|data/.test(key)) {
      for (const item of value) collect(item, posts, users);
    }
  }
  if (payload?.data && !Array.isArray(payload.data)) collect(payload.data, posts, users);
  if (payload?.post) collect(payload.post, posts, users);

  return posts.map((post) => ({
    id: String(post.id ?? post.id_str ?? ""),
    text: post.text ?? post.full_text ?? "",
    author_id: String(post.author_id ?? post.user?.id_str ?? post.user?.id ?? ""),
    username: post.user?.screen_name ?? users.get(String(post.author_id)) ?? null
  })).filter((post) => post.id && post.text);
}

function collect(item, posts, users) {
  if (!item || typeof item !== "object") return;
  const post = item.post ?? item.tweet ?? item;
  if (post.id ?? post.id_str) posts.push(post);
  if (post.user?.id_str && post.user?.screen_name) users.set(String(post.user.id_str), post.user.screen_name);
}
