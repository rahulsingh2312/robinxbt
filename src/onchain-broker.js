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

  const wantsBuy = /\b(buy|ape|grab|get me|send it|yolo)\b/i.test(command);
  const amountUsd = parseUsdAmount(command);
  const address = command.match(/\b(0x[0-9a-fA-F]{40})\b/)?.[1] ?? null;
  let term = address;
  if (!term) {
    const afterVerb = command.match(/\b(?:buy|ape|grab)\b(?:\s+\$?[\d,.]+k?\s*(?:usd|dollars|bucks|worth)?\s*(?:of)?)?\s+\$?([A-Za-z][A-Za-z0-9]{0,14})\b/i)?.[1];
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
  }

  async ensureWallet(botUsername, authorId, username) {
    return this.vault.ensureWallet(this.store, botUsername, authorId, username);
  }

  // The single reply-producing entry point. `parentText` is the post the user
  // replied to (usually the bot's own advice) — that is where "buy" without a
  // ticker gets its asset from, exactly as the advice flow promises.
  async handleBuy({ botUsername, authorId, username, intent, parentText, pendingBuy, dryRun }) {
    const wallet = await this.ensureWallet(botUsername, authorId, username);

    const term = intent.term ?? pendingBuy?.term ?? extractAssetTerms(parentText ?? "")[0] ?? null;
    if (!term) {
      return { reply: `Tell me what to buy — a ticker like $NVDA or a contract address, plus a dollar amount.` };
    }
    const asset = await this.resolver.resolve(term);
    if (asset?.ambiguous) {
      return { reply: `Several tokens trade as ${term} and none is clearly the real one. Reply with the contract address and I’ll use exactly that.` };
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
        reply: `You’ve got the $${amountUsd} in USDG, but no ETH for gas. Send a little ETH on Robinhood Chain (${formatEthAmount(Math.max(this.config.gasReserveEth * 2, 0.0005))} covers it) — address on your portfolio page, link in bio — then tell me to buy again.`
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
        reply: `Your wallet’s short for that — send ${formatEthAmount(shortfall)} more ETH (or $${amountUsd} USDG plus gas dust). ${where}, then tell me to buy again.`
      };
    }

    if (dryRun) {
      return { reply: `[dry run] would swap ${spend.label} (≈$${amountUsd}) for ${asset.symbol} from ${wallet.address}.` };
    }

    const signer = this.vault.signerFor(wallet, this.chain.provider);
    const result = await this.dex.swap(signer, spend.tokenIn, asset.address, spend.amountIn);
    const meta = await this.chain.getTokenMeta(asset.address);
    const filled = Number(result.quotedOut) / 10 ** meta.decimals;
    this.logger.info(`Onchain buy: $${amountUsd} of ${asset.symbol} for author ${authorId}, tx ${result.hash}`);
    return {
      reply: `Bought ~${formatQty(filled)} ${asset.symbol} for $${amountUsd}. It’s in your wallet — check the portfolio link in bio to see and manage your assets.`,
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

  async fetchHoldings(address) {
    const base = this.config.blockscoutBaseUrl.replace(/\/$/, "");
    const response = await fetch(`${base}/api/v2/addresses/${address}/token-balances`);
    if (!response.ok) return [];
    const items = await response.json();
    return items
      .filter((item) => item.token?.type === "ERC-20" && item.value !== "0")
      .map((item) => {
        const decimals = Number(item.token.decimals ?? 18);
        const amount = Number(item.value) / 10 ** decimals;
        const price = item.token.exchange_rate ? Number(item.token.exchange_rate) : null;
        return { symbol: item.token.symbol, name: item.token.name, address: item.token.address_hash ?? item.token.address, icon: item.token.icon_url ?? null, amount, priceUsd: price, valueUsd: price ? amount * price : null };
      })
      .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  }
}

// Scaled-integer division: floats cannot represent most USD/ETH ratios and
// toFixed(18) would leak double-precision garbage into the wei amount.
function usdToWei(amountUsd, ethUsd) {
  return (BigInt(Math.round(amountUsd * 1e6)) * 10n ** 18n) / BigInt(Math.round(ethUsd * 1e6));
}

function formatEthAmount(value) {
  return Number(value.toFixed(5)).toString();
}

function formatQty(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 1 ? 4 : 8 }).format(value);
}
