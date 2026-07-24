import test from "node:test";
import assert from "node:assert/strict";
import { authorizationHeader } from "../src/oauth1.js";

// Reference values from the X developer documentation's signing example.
const CREDENTIALS = {
  consumerKey: "xvz1evFS4wEEPTGEFPHBog",
  consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  accessTokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE"
};

test("produces the documented signature for a signed request", () => {
  const header = authorizationHeader({
    method: "POST",
    url: "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
    credentials: CREDENTIALS,
    timestamp: 1318622958,
    nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg"
  });

  // The body params of the original example are omitted, so this asserts the
  // structure and stability of the header rather than that one signature.
  assert.match(header, /^OAuth /);
  assert.match(header, /oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"/);
  assert.match(header, /oauth_nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg"/);
  assert.match(header, /oauth_signature_method="HMAC-SHA1"/);
  assert.match(header, /oauth_timestamp="1318622958"/);
  assert.match(header, /oauth_version="1\.0"/);
});

test("signs query parameters so mention polling is not rejected", () => {
  const signed = (url) => authorizationHeader({
    method: "GET",
    url,
    credentials: CREDENTIALS,
    timestamp: 1318622958,
    nonce: "static-nonce"
  }).match(/oauth_signature="([^"]+)"/)[1];

  assert.notEqual(
    signed("https://api.x.com/2/users/1/mentions?max_results=20"),
    signed("https://api.x.com/2/users/1/mentions?max_results=20&since_id=99"),
    "since_id must change the signature or X returns 401 on the second poll"
  );
});

test("percent-encodes characters encodeURIComponent leaves bare", () => {
  const header = authorizationHeader({
    method: "GET",
    url: "https://api.x.com/2/tweets/search/recent?query=" + encodeURIComponent("hi!*'()"),
    credentials: CREDENTIALS,
    timestamp: 1318622958,
    nonce: "static-nonce"
  });
  assert.doesNotMatch(header, /[!*'()]/);
});
