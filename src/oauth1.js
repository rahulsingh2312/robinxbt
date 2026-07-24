import { createHmac, randomBytes } from "node:crypto";

// X accepts two user-context schemes. OAuth 1.0a is the only one you can use
// with keys generated straight from the developer portal, so it needs no
// browser redirect flow for a bot that only ever posts as itself.
export function authorizationHeader({ method, url, credentials, timestamp, nonce }) {
  const target = new URL(url);
  const parameters = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0"
  };

  // Only query parameters join the signature base. A JSON request body never
  // does, which is why the reply payload below is signed as an empty body.
  const signatureParameters = { ...parameters };
  for (const [key, value] of target.searchParams) signatureParameters[key] = value;

  const base = [
    method.toUpperCase(),
    encode(`${target.origin}${target.pathname}`),
    encode(sortedQuery(signatureParameters))
  ].join("&");
  const key = `${encode(credentials.consumerSecret)}&${encode(credentials.accessTokenSecret)}`;
  parameters.oauth_signature = createHmac("sha1", key).update(base).digest("base64");

  const header = Object.keys(parameters)
    .sort()
    .map((name) => `${encode(name)}="${encode(parameters[name])}"`)
    .join(", ");
  return `OAuth ${header}`;
}

function sortedQuery(parameters) {
  return Object.keys(parameters)
    .map((name) => [encode(name), encode(parameters[name])])
    .sort((first, second) => (first[0] < second[0] ? -1 : first[0] > second[0] ? 1 : first[1] < second[1] ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

// RFC 3986. encodeURIComponent leaves !*'() unescaped and X rejects the result.
function encode(value) {
  return encodeURIComponent(String(value)).replace(
    /[!*'()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
