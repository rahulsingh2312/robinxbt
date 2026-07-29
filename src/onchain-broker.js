import { formatEther, parseEther } from "ethers";
import { extractAssetTerms } from "./asset-resolver.js";
import { NATIVE } from "./dex.js";

// Reads a buy out of a mention. Unlike the operator-account parser this one
// accepts contract addresses and long memecoin tickers, and it tolerates a
// missing amount or missing asset — the worker fills either from conversation
// context (the bot's earlier advice, or a pending ask for size).
export function parseBuyIntent(text, botUsername) {
  const command = String(text ?? "")
    .replace(new RegExp(`@${botUsername}\\b`, "ig"), " ")
    .replace(/[“”"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!command) return null;

  // A question is a question, never an order: "would you buy $50 of NVDA?"
  // used to execute because it carried an amount.
  if (command.includes("?")) return null;
  // Only unambiguous imperatives move money. "grab a coffee, that will be $5"
  // and "get me out of here for $10" both used to fill.
  const wantsBuy = /\b(buy|ape into|aping into)\b/i.test(command);
  const address = command.match(/\b(0x[0-9a-fA-F]{40})\b/)?.[1] ?? null;
  // Amounts are read from the text with any contract address removed, so the
  // digits inside an address cannot be parsed as a dollar figure.
  const amountUsd = parseUsdAmount(command.replace(/\b0x[0-9a-fA-F]{40}\b/g, " "));
  let term = address;
  if (!term) {
    const afterVerb = command.match(/\b(?:buy|ape into|aping into)\b(?:\s+\$?[\d,.]+k?\s*(?:usd|dollars|bucks|worth)?\s*(?:of)?)?\s+\$?([A-Za-z][A-Za-z0-9]{0,14})\b/i)?.[1];
    if (afterVerb && !/^(me|some|that|this|it|the|a|an|usd|dollars|bucks|worth|of)$/i.test(afterVerb)) term = afterVerb.toUpperCase();
    if (!term) {
      const cashtag = command.match(/\$([A-Za-z][A-Za-z0-9]{0,14})\b/)?.[1];
      if (cashtag && !/^\d/.test(cashtag)) term = cashtag.toUpperCase();
    }
  }

  if (!wantsBuy && amountUsd === null) return null;
  if (!wantsBuy && term) return null; // a bare "$50" reply is an amount, not an order for token "50"
  return { wantsBuy, amountUsd, term };
}

// "$50", "50$", "$1.5k", "20 bucks" — replies rarely spell out "USD".
export function parseUsdAmount(text) {
  const match = String(text ?? "").match(/(?:\$\s?([\d,]+(?:\.\d+)?)\s*(k)?|([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:\$|usd\b|dollars\b|bucks\b))/i);
  if (!match) return null;
  const raw = (match[1] ?? match[3]).replace(/,/g, "");
  const thousands = Boolean(match[2] ?? match[4]);
  const value = Number(raw) * (thousands ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Executes buys against each user's own Robinhood Chain wallet. Nothing here
// touches the operator's brokerage account and there is no allowlist: the only
// money that can move is money the user themselves deposited to a wallet only
// this service can sign for.
export class OnchainBroker {
  constructor({ store, vault, chain, dex, resolver, config, logger = console }) {
    this.store = store;
    this.vault = vault;
    this.chain = chain;
    this.dex = dex;
    this.resolver = resolver;
    this.config = config;
    this.logger = logger;
    // One buy at a time per wallet: two mentions racing through the same
    // signer would collide on the account nonce and double-count balances.
    this.walletLocks = new Map();
    // Many viewers of one portfolio should be one explorer call, not many.
    this.holdingsCache = new Map();
  }

  async withWalletLock(authorId, work) {
    // In-process queue first (cheap), then a database advisory lock so a
    // second app instance cannot sign concurrently for the same wallet.
    if (this.store.withAdvisoryLock) {
      return this.queueLocally(authorId, () => this.store.withAdvisoryLock(`wallet:${authorId}`, work));
    }
    return this.queueLocally(authorId, work);
  }

  queueLocally(authorId, work) {
    const key = String(authorId);
    const previous = this.walletLocks.get(key) ?? Promise.resolve();
    const current = previous.then(work, work);
    // The stored promise never rejects, so a failed buy can't poison the queue.
    const settled = current.catch(() => {});
    this.walletLocks.set(key, settled);
    settled.then(() => {
      if (this.walletLocks.get(key) === settled) this.walletLocks.delete(key);
    });
    return current;
  }

  async ensureWallet(botUsername, authorId, username) {
    return this.vault.ensureWallet(this.store, botUsername, authorId, username);
  }

  // The single reply-producing entry point, serialized per wallet so racing
  // mentions can't collide on nonces or double-spend a balance check.
  async handleBuy(request) {
    return this.withWalletLock(request.authorId, () => this.executeBuy(request));
  }

  // `parentText` is the post the user replied to (usually the bot's own
  // advice) — that is where "buy" without a ticker gets its asset from,
  // exactly as the advice flow promises.
  async executeBuy({ botUsername, authorId, username, intent, parentText, contextFromBot = false, pendingBuy, dryRun }) {
    const wallet = await this.ensureWallet(botUsername, authorId, username);

    const ownTerm = intent.term ?? pendingBuy?.term ?? null;
    const contextTerm = ownTerm ? null : extractAssetTerms(parentText ?? "")[0] ?? null;
    const term = ownTerm ?? contextTerm;
    // An asset lifted from someone else's tweet is named in the reply, so the
    // buyer can see exactly what their money went into.
    const borrowed = Boolean(contextTerm && !contextFromBot);
    if (!term) {
      return { reply: `Tell me what to buy: a ticker like $NVDA or a contract address, plus a dollar amount.` };
    }
    const asset = await this.resolver.resolve(term);
    if (asset?.ambiguous) {
      return { reply: `Several tokens trade as ${term} and none is clearly the real one. Reply with the contract address and I’ll use exactly that.` };
    }
    if (asset?.unverified) {
      return { reply: `${asset.symbol} on Robinhood Chain isn’t an issuer-verified token, and tickers are free to fake. Reply with the exact contract address if you still want it.` };
    }
    if (!asset) {
      return { reply: `Couldn’t find ${term} on Robinhood Chain. If it’s a memecoin, reply with its contract address.` };
    }

    // Probe for a live market BEFORE any funding ask: a token that resolves
    // but has no pool must never cause someone to deposit ETH for a buy that
    // can only fail. Probing from ETH covers USDG-quoted pools too, because
    // route discovery includes the two-hop through USDG.
    const probe = await this.dex.findBestRoute(NATIVE, asset.address, 10n ** 15n);
    if (!probe) {
      return { reply: `${asset.symbol} exists on Robinhood Chain but has no tradable market right now, so I can’t buy it.` };
    }

    const amountUsd = intent.amountUsd ?? pendingBuy?.amountUsd ?? null;
    if (!amountUsd) {
      // No size yet: the worker saves this against its own reply ID so the
      // user's next "$50" lands on the right asset.
      return {
        reply: `How much ${asset.symbol}? Reply with a dollar amount like $25 and I’ll fill it from your wallet.`,
        pendingBuy: { authorId: String(authorId), term: asset.address }
      };
    }
    if (amountUsd > this.config.maxOrderUsd) {
      return { reply: `That’s over my per-order cap of $${this.config.maxOrderUsd}. Try a smaller size.` };
    }

    const ethUsd = await this.dex.ethUsdPrice();
    const amountEth = amountUsd / ethUsd;
    const gasReserve = parseEther(String(this.config.gasReserveEth));
    const usdgAddress = this.dex.addresses.usdg;
    const [ethBalance, usdgDecimals] = await Promise.all([
      this.chain.getEthBalance(wallet.address),
      this.dex.usdgDecimals()
    ]);
    const usdgBalance = (await this.chain.getTokenBalance(usdgAddress, wallet.address)).raw;

    // The wallet spends whichever asset covers the order — USDG first (it's
    // the dollar, so a $50 buy is exactly $50), falling back to ETH. The user
    // is never asked which; the wallet decides. Every path still pays gas in
    // ETH, so a sliver stays reserved.
    const wantWei = usdToWei(amountUsd, ethUsd);
    const usdgUnits = BigInt(Math.round(amountUsd * 10 ** usdgDecimals));
    let spend = null;
    if (usdgBalance >= usdgUnits && ethBalance >= gasReserve) {
      spend = { tokenIn: usdgAddress, amountIn: usdgUnits, label: `$${amountUsd} USDG` };
    } else if (ethBalance >= wantWei + gasReserve) {
      spend = { tokenIn: NATIVE, amountIn: wantWei, label: `~${formatEthAmount(amountEth)} ETH` };
    }

    // Dollars present but nothing to pay the network with: a precise ask
    // beats the generic funding message.
    if (!spend && usdgBalance >= usdgUnits) {
      return {
        reply: `You’ve got the $${amountUsd} in USDG, but no ETH for gas. Send a little ETH on Robinhood Chain (${formatEthAmount(Math.max(this.config.gasReserveEth * 2, 0.0005))} covers it). Address on your portfolio page, link in bio. Then tell me to buy again.`
      };
    }

    if (!spend) {
      const shortfall = Number(formatEther(wantWei + gasReserve - ethBalance));
      // The deposit address normally lives on the portfolio site, not in the
      // reply: X rejects posts containing crypto addresses ("prohibited for
      // the first 7 days after authentication", and spam-filtered after).
      // ONCHAIN_ADDRESS_IN_REPLIES restores the inline address once the
      // account is old enough to be allowed to post one.
      const where = this.config.addressInReplies
        ? `Send to ${wallet.address} on Robinhood Chain`
        : `Your deposit address is on your portfolio page (link in bio, @${wallet.xUsername || username})`;
      return {
        reply: `Your wallet’s short for that. Send ${formatEthAmount(shortfall)} more ETH (or $${amountUsd} USDG plus gas dust). ${where}, then tell me to buy again.`
      };
    }

    // Quote the actual size once, then guard and execute on that same route.
    const route = await this.dex.findBestRoute(spend.tokenIn, asset.address, spend.amountIn);
    if (!route) {
      return { reply: `${asset.symbol} has no tradable market at that size right now, so I can’t buy it.` };
    }
    const meta = await this.chain.getTokenMeta(asset.address);

    // Thin-pool guard, measured two ways because either source can lie.
    // First against the indexed price when one exists.
    if (asset.priceUsd) {
      const outValueUsd = (Number(route.amountOut) / 10 ** meta.decimals) * asset.priceUsd;
      const impact = 1 - outValueUsd / amountUsd;
      if (impact > this.config.maxPriceImpactBps / 10000) {
        return { reply: `Liquidity for ${asset.symbol} is too thin: a $${amountUsd} buy would lose ${(impact * 100).toFixed(1)}% to price impact. Not doing that to you.` };
      }
    }
    // Then against the pool itself: quote selling the output straight back.
    // A honeypot or a pool seeded to swallow buys fails here even when the
    // explorer has never priced the token, which is exactly the case where
    // the check above cannot help.
    const roundTrip = await this.dex.findBestRoute(asset.address, spend.tokenIn, route.amountOut).catch(() => null);
    if (!roundTrip || roundTrip.amountOut === 0n) {
      return { reply: `${asset.symbol} can be bought but not sold back right now, which is how honeypots work. Skipping it.` };
    }
    const retained = Number(roundTrip.amountOut) / Number(spend.amountIn);
    const roundTripLossBps = Math.round((1 - retained) * 10000);
    // A round trip always costs two pool fees, so the allowance is the impact
    // budget doubled plus a fee margin.
    if (roundTripLossBps > this.config.maxPriceImpactBps * 2 + 200) {
      return { reply: `${asset.symbol} would lose ${(roundTripLossBps / 100).toFixed(1)}% on a buy-then-sell round trip. That pool is too thin or rigged. Not doing it.` };
    }

    // Re-assert the cap against the real outlay: the ETH path sizes through a
    // spot quote, and a depressed quote would otherwise send more ETH than the
    // stated dollars while still passing the earlier check.
    const spendUsd = spend.tokenIn === NATIVE
      ? (Number(spend.amountIn) / 1e18) * ethUsd
      : Number(spend.amountIn) / 10 ** usdgDecimals;
    if (spendUsd > this.config.maxOrderUsd * 1.05) {
      return { reply: `Pricing looks off right now (that would spend about $${Math.round(spendUsd)} for a $${amountUsd} order), so I'm not sending it.` };
    }

    if (dryRun) {
      return { reply: `[dry run] would swap ${spend.label} (≈$${amountUsd}) for ${asset.symbol} from ${wallet.address}.` };
    }

    const signer = this.vault.signerFor(wallet, this.chain.provider);
    const result = await this.dex.swap(signer, spend.tokenIn, asset.address, spend.amountIn, { route });
    const filled = Number(result.quotedOut) / 10 ** meta.decimals;
    this.logger.info(`Onchain buy: $${amountUsd} of ${asset.symbol} for author ${authorId}, tx ${result.hash}`);
    const provenance = borrowed && !asset.official ? ` (${asset.symbol} came from that tweet, not from me)` : "";
    return {
      reply: `Bought ~${formatQty(filled)} ${asset.symbol} for $${amountUsd}${provenance}. It’s in your wallet. Check the portfolio link in bio to see and manage your assets.`,
      txHash: result.hash
    };
  }

  // What "portfolio" answers when on-chain mode is live: the user's real
  // holdings, priced by the explorer, no URL in the reply (links cost 13x).
  async describePortfolio(botUsername, authorId, username) {
    const wallet = await this.ensureWallet(botUsername, authorId, username);
    const eth = await this.chain.getEthBalance(wallet.address);
    const holdings = await this.fetchHoldings(wallet.address);
    const parts = [`${formatEthAmount(Number(formatEther(eth)))} ETH`];
    for (const holding of holdings.slice(0, 3)) {
      parts.push(`${formatQty(holding.amount)} ${holding.symbol}${holding.valueUsd ? ` ($${Math.round(holding.valueUsd)})` : ""}`);
    }
    const more = holdings.length > 3 ? ` +${holdings.length - 3} more` : "";
    // No address fragments here either — X's crypto-address filter is the
    // reason the funding reply already points at the site.
    return `Your wallet: ${parts.join(", ")}${more}. Full view, deposit address, and controls at the portfolio link in bio.`;
  }

  // Airdropped spam is the default state of any open chain: unpriced tokens
  // named after a phishing link, or a second "USDG" hoping to be mistaken for
  // the real one. Holdings show what the wallet actually owns; the junk is
  // counted and dropped.
  async fetchHoldings(address) {
    const cacheKey = address.toLowerCase();
    const hit = this.holdingsCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 5_000) return hit.value;
    const base = this.config.blockscoutBaseUrl.replace(/\/$/, "");
    const response = await fetch(`${base}/api/v2/addresses/${address}/token-balances`, {
      signal: AbortSignal.timeout(8_000)
    }).catch(() => null);
    if (!response?.ok) return hit?.value ?? [];
    const items = await response.json();
    const all = items
      .filter((item) => item.token?.type === "ERC-20" && item.value !== "0")
      .map((item) => {
        const token = item.token;
        const decimals = Number(token.decimals ?? 18);
        const amount = Number(item.value) / 10 ** decimals;
        const price = token.exchange_rate ? Number(token.exchange_rate) : null;
        return {
          symbol: token.symbol ?? "?",
          name: token.name ?? "",
          address: token.address_hash ?? token.address,
          icon: token.icon_url ?? null,
          official: /• Robinhood Token$/.test(token.name ?? ""),
          amount,
          priceUsd: price,
          valueUsd: price ? amount * price : null
        };
      });

    const real = all.filter((holding) => !isSpamToken(holding));
    // Two tokens claiming one ticker: the issuer-verified or priced one is the
    // real holding, the other is an impersonation.
    const bySymbol = new Map();
    for (const holding of real.sort((a, b) => rank(b) - rank(a))) {
      const key = holding.symbol.toUpperCase();
      const kept = bySymbol.get(key);
      if (!kept) bySymbol.set(key, holding);
      else kept.duplicates = (kept.duplicates ?? 0) + 1;
    }
    const holdings = [...bySymbol.values()].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
    holdings.hiddenCount = all.length - holdings.length;
    this.holdingsCache.set(cacheKey, { value: holdings, at: Date.now() });
    if (this.holdingsCache.size > 5_000) this.holdingsCache.clear();
    return holdings;
  }
}

// Scaled-integer division: floats cannot represent most USD/ETH ratios and
// toFixed(18) would leak double-precision garbage into the wei amount.
// Ranking for the duplicate-ticker contest: issuer-verified beats priced,
// priced beats anything else.
function rank(holding) {
  return (holding.official ? 4 : 0) + (holding.priceUsd ? 2 : 0) + (holding.icon ? 1 : 0);
}

// Spam advertises itself: a name that is really a URL or an instruction, or a
// token nobody has ever priced. Issuer-verified and priced tokens are always
// kept, whatever they are called.
const SPAM_TEXT = /(https?:|www\.|\.com|\.net|\.xyz|\.io\b|\.org|claim|airdrop|reward|voucher|visit |free |giveaway|winner|access|t\.me|discord|telegram)/i;

function isSpamToken(holding) {
  if (holding.official) return false;
  if (SPAM_TEXT.test(`${holding.name} ${holding.symbol}`)) return true;
  // Never priced by the explorer and never given an icon: nobody trades it,
  // and it arrived unrequested.
  if (!holding.priceUsd && !holding.icon) return true;
  return false;
}

function usdToWei(amountUsd, ethUsd) {
  return (BigInt(Math.round(amountUsd * 1e6)) * 10n ** 18n) / BigInt(Math.round(ethUsd * 1e6));
}

function formatEthAmount(value) {
  return Number(value.toFixed(5)).toString();
}

function formatQty(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 1 ? 4 : 8 }).format(value);
}
