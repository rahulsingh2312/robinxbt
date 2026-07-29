import { formatEther, parseEther } from "ethers";
import { extractAssetTerms } from "./asset-resolver.js";
import { NATIVE } from "./dex.js";
import { TradeVoice } from "./trade-voice.js";

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

  // Sells and portfolio checks are recognized here too, so the bot keeps
  // working when the model is unavailable.
  if (/\b(sell|dump|cash out|liquidate|unload)\b/i.test(command)) {
    const sellTerm = command.match(/\b(0x[0-9a-fA-F]{40})\b/)?.[1]
      ?? command.match(/\b(?:sell|dump|cash out|liquidate|unload)\b(?:\s+(?:all|half|some|my|of|the))*\s+\$?([A-Za-z][A-Za-z0-9]{0,14})\b/i)?.[1]
      // "cash out $5 of WOJ": the asset trails the amount, not the verb.
      ?? command.match(/\bof\s+\$?([A-Za-z][A-Za-z0-9]{0,14})\b/i)?.[1]
      ?? null;
    return {
      wantsSell: true,
      wantsBuy: false,
      term: sellTerm && !FILLER.test(sellTerm) ? sellTerm.toUpperCase() : null,
      amountUsd: parseUsdAmount(command.replace(/\b0x[0-9a-fA-F]{40}\b/g, " ")),
      portion: /\bhalf\b/i.test(command) ? 0.5 : /\bquarter\b/i.test(command) ? 0.25 : 1
    };
  }
  if (/\b(portfolio|holdings|my bag|what do i (?:have|own|hold)|what am i holding)\b/i.test(command)) {
    return { wantsPortfolio: true, wantsBuy: false, amountUsd: null, term: null };
  }
  // Only unambiguous imperatives move money. "grab a coffee, that will be $5"
  // and "get me out of here for $10" both used to fill.
  const wantsBuy = /\b(buy|ape into|aping into)\b/i.test(command);
  const address = command.match(/\b(0x[0-9a-fA-F]{40})\b/)?.[1] ?? null;
  // Amounts are read from the text with any contract address removed, so the
  // digits inside an address cannot be parsed as a dollar figure.
  const amountUsd = parseUsdAmount(command.replace(/\b0x[0-9a-fA-F]{40}\b/g, " "));
  let term = address;
  if (!term) {
    const afterVerb = command.match(/\b(?:buy|ape into|aping into)\b(?:\s+\$?[\d,.]+k?\s*(?:usd|dollars?|dollers?|bucks?|worth)?\s*(?:of|worth of)?)?\s+\$?([A-Za-z][A-Za-z0-9]{0,14})\b/i)?.[1];
    if (afterVerb && !FILLER.test(afterVerb)) term = afterVerb.toUpperCase();
    if (!term) {
      // "buy me $20 of pepe", "put 5 into wif": the asset trails a preposition
      // rather than the verb.
      const afterPreposition = command.match(/\b(?:of|into|in|on)\s+\$?([A-Za-z][A-Za-z0-9]{0,14})\b/i)?.[1];
      if (afterPreposition && !FILLER.test(afterPreposition)) term = afterPreposition.toUpperCase();
    }
    if (!term) {
      const cashtag = command.match(/\$([A-Za-z][A-Za-z0-9]{0,14})\b/)?.[1];
      if (cashtag && !/^\d/.test(cashtag)) term = cashtag.toUpperCase();
    }
  }

  // A bare contract address is almost always someone answering "reply with
  // the contract address". It carries no verb and no amount, but it is a
  // direct answer and must reach the pending-buy flow rather than the model.
  if (!wantsBuy && address) return { wantsBuy: false, amountUsd, term: address };
  if (!wantsBuy && amountUsd === null) return null;
  if (!wantsBuy && term) return null; // a bare "$50" reply is an amount, not an order for token "50"
  return { wantsBuy, amountUsd, term };
}

// Words that stand where an asset would but never name one.
const FILLER = /^(me|us|some|that|this|it|the|a|an|usd|dollars?|dollers?|bucks?|worth|of|for|in|into|on|please|pls|now|my|your)$/i;

// "$50", "50$", "$1.5k", "20 bucks" — replies rarely spell out "USD".
export function parseUsdAmount(text) {
  const match = String(text ?? "").match(/(?:\$\s?([\d,]+(?:\.\d+)?)\s*(k)?|([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:\$|usd\b|dollars?\b|bucks?\b|dollers?\b))/i);
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
    // Fills and refusals speak in the account's voice; the numbers inside
    // them are produced here and never by the phrasing.
    this.voice = new TradeVoice(config.persona);
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

    // Whichever half the pending record holds fills in for the half missing
    // from this message: an address answering "which token", or a size
    // answering "how much".
    const ownTerm = intent.term ?? pendingBuy?.term ?? null;
    const contextTerm = ownTerm ? null : extractAssetTerms(parentText ?? "")[0] ?? null;
    const term = ownTerm ?? contextTerm;
    // An asset lifted from someone else's tweet is named in the reply, so the
    // buyer can see exactly what their money went into.
    const borrowed = Boolean(contextTerm && !contextFromBot);
    // A contract address names one exact contract, so there is nothing left
    // to guess and nothing for a guard to protect against being wrong about.
    // This is a memecoin bot: when the address is on the table, the trade
    // goes through and the reply reports what it cost. Ticker buys keep every
    // guard, because a ticker is a name anyone can claim.
    const explicitAddress = /^0x[0-9a-fA-F]{40}$/.test(String(term ?? ""));
    if (!term) {
      return { reply: this.voice.say("askAsset") };
    }
    let asset = await this.resolver.resolve(term);
    if (asset?.ambiguous) {
      return { reply: `Several tokens trade as ${term} and none is clearly the real one. Reply with the contract address and I’ll use exactly that.` };
    }
    // An unverified ticker is decided by the pools, not by the explorer's
    // numbers: whichever candidate actually holds liquidity at this size wins.
    // Faking that costs an attacker real money, and anything they do fund can
    // be sold back out — which is the property the round-trip check verifies.
    if (asset?.unverified) {
      // Size the check to what they are actually spending: a pool that cannot
      // take $20 may be entirely fine for $1.40.
      const intendedUsd = intent.amountUsd ?? pendingBuy?.amountUsd ?? null;
      const probeWei = intendedUsd
        ? usdToWei(intendedUsd, await this.dex.ethUsdPrice().catch(() => 2000))
        : 10n ** 15n;
      const vetted = await this.pickByLiquidity(asset.candidates, probeWei);
      if (!vetted) {
        // Distinguish "I don't trust it" from "the chain can't fill it".
        const named = asset.candidates[0];
        return {
          reply: `${asset.symbol} trades, but not through the pools I can reach: a buy right now would lose most of its value on the way in. I'd be burning your money, so no. Ask me for something with real on-chain depth, like a stock token.`,
          detail: named?.address
        };
      }
      asset = vetted;
    }
    if (!asset) {
      // Hold the size against our own reply, so a bare contract address in
      // response finishes the order instead of starting a new conversation.
      const pendingSize = intent.amountUsd ?? pendingBuy?.amountUsd ?? null;
      return {
        reply: `Couldn’t find ${term} on Robinhood Chain. Reply with its contract address and I’ll buy that exact token.`,
        ...(pendingSize ? { pendingBuy: { authorId: String(authorId), amountUsd: pendingSize } } : {})
      };
    }

    // Probe for a live market BEFORE any funding ask: a token that resolves
    // but has no pool must never cause someone to deposit for a buy that can
    // only fail. Both quote currencies count, because memecoins trade against
    // ETH and stock tokens against USDG, and the wallet converts either way.
    const probes = await Promise.all([
      this.dex.findBestRoute(NATIVE, asset.address, 10n ** 15n).catch(() => null),
      this.dex.findBestRoute(this.dex.addresses.usdg, asset.address, 1_000_000n).catch(() => null)
    ]);
    const probe = probes.find(Boolean) ?? null;
    if (!probe) {
      return { reply: `${asset.symbol} exists on Robinhood Chain but has no tradable market right now, so I can’t buy it.` };
    }

    const amountUsd = intent.amountUsd ?? pendingBuy?.amountUsd ?? null;
    if (!amountUsd) {
      // No size yet: the worker saves this against its own reply ID so the
      // user's next "$50" lands on the right asset.
      return {
        reply: this.voice.say("askAmount", { symbol: asset.symbol }),
        pendingBuy: { authorId: String(authorId), term: asset.address }
      };
    }
    if (amountUsd > this.config.maxOrderUsd) {
      return { reply: this.voice.say("overCap", { cap: this.config.maxOrderUsd }) };
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
    // USDG only pays directly when a USDG pool for this token exists. Most
    // memecoins are quoted in ETH, so otherwise the dollars are converted to
    // ETH first and the buy happens from there.
    // Which currencies can actually reach this token. Most memecoins are
    // quoted in ETH and most stock tokens in USDG, so the wallet has to be
    // willing to convert: a wallet holding only ETH still cannot touch AAPL
    // without buying dollars first, and vice versa.
    const [ethPool, usdgPool] = await Promise.all([
      this.dex.findBestRoute(NATIVE, asset.address, wantWei).catch(() => null),
      this.dex.findBestRoute(usdgAddress, asset.address, usdgUnits).catch(() => null)
    ]);

    const hasUsdg = usdgBalance >= usdgUnits && ethBalance >= gasReserve;
    const hasEth = ethBalance >= wantWei + gasReserve;

    let spend = null;
    if (usdgPool && hasUsdg) {
      spend = { tokenIn: usdgAddress, amountIn: usdgUnits, label: `$${amountUsd} USDG` };
    } else if (ethPool && hasEth) {
      spend = { tokenIn: NATIVE, amountIn: wantWei, label: `~${formatEthAmount(amountEth)} ETH` };
    } else if (ethPool && hasUsdg) {
      // Dollars in the wallet, but the token only trades against ETH.
      spend = { tokenIn: usdgAddress, amountIn: usdgUnits, convertTo: NATIVE, label: `$${amountUsd} USDG` };
    } else if (usdgPool && hasEth) {
      // ETH in the wallet, but the token only trades against dollars.
      spend = { tokenIn: NATIVE, amountIn: wantWei, convertTo: usdgAddress, label: `~${formatEthAmount(amountEth)} ETH` };
    }

    // Dollars present but nothing to pay the network with: a precise ask
    // beats the generic funding message.
    if (!spend && usdgBalance >= usdgUnits) {
      return {
        reply: this.voice.say("needsGas", {
          usd: amountUsd,
          gas: formatEthAmount(Math.max(this.config.gasReserveEth * 2, 0.0005))
        })
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
        reply: this.voice.say("needsFunds", { shortfall: formatEthAmount(shortfall), usd: amountUsd, where })
      };
    }

    // Quote, guard, and execute against the currency that will actually buy
    // the token. On the convert-first path that is ETH, not the USDG being
    // sold to obtain it, so the pool being checked is the pool being used.
    const buyWith = spend.convertTo ?? spend.tokenIn;
    const buyAmount = spend.convertTo === NATIVE ? wantWei : spend.convertTo ? usdgUnits : spend.amountIn;
    const route = await this.dex.findBestRoute(buyWith, asset.address, buyAmount);
    if (!route) {
      return { reply: this.voice.say("noMarket", { symbol: asset.symbol }) };
    }
    const meta = await this.chain.getTokenMeta(asset.address);

    // What this order actually costs, measured on the chain rather than
    // assumed. A deep stock pool and a thin memecoin pool are different
    // products, so each gets a budget that matches how it really behaves.
    const budget = asset.official ? this.config.maxPriceImpactBps : this.config.maxPriceImpactUnverifiedBps;

    // Sell the position straight back to see what the pool would give: this
    // catches honeypots and rigged depth even for tokens nobody has priced.
    const roundTrip = await this.dex.findBestRoute(asset.address, buyWith, route.amountOut).catch(() => null);
    if (!roundTrip || roundTrip.amountOut === 0n) {
      return { reply: `${asset.symbol} can be bought but not sold back right now, which is how honeypots work. Skipping it.` };
    }
    const roundTripLossBps = Math.round((1 - Number(roundTrip.amountOut) / Number(buyAmount)) * 10000);
    // A round trip pays the pool fee twice and crosses the spread twice, so
    // the fair comparison is roughly double the one-way budget. Past that the
    // exit is thin, which is worth saying out loud but is not by itself a
    // reason to refuse: what the buyer pays going IN is judged below, and
    // people knowingly buy illiquid things. Only a pool that gives back almost
    // nothing is refused, because that is a honeypot rather than a market.
    const exitWarning = roundTripLossBps > budget * 2 + 100
      ? ` Heads up: exit liquidity is thin, selling back right now would cost about ${(roundTripLossBps / 100).toFixed(0)}%.`
      : "";
    if (roundTripLossBps > 9000 && !explicitAddress) {
      return { reply: this.voice.say("honeypot", { symbol: asset.symbol }) };
    }

    // One-way impact against the indexed price, when there is one to compare
    // against. Half the round trip is the fallback estimate for tokens the
    // explorer has never priced.
    let impactBps = Math.max(0, Math.round(roundTripLossBps / 2));
    if (asset.priceUsd) {
      const outValueUsd = (Number(route.amountOut) / 10 ** meta.decimals) * asset.priceUsd;
      impactBps = Math.max(0, Math.round((1 - outValueUsd / amountUsd) * 10000));
      if (impactBps > budget && !explicitAddress) {
        return { reply: this.voice.say("tooThin", { symbol: asset.symbol, percent: (impactBps / 100).toFixed(1), usd: amountUsd }) };
      }
    }

    // Slippage is the room between the quote and the fill, so it should track
    // how much this pool moves, not a single global guess. Too tight and every
    // memecoin buy reverts; too loose and a sandwich has somewhere to hide.
    // A named-contract buy is meant to land, so it gets the full slippage
    // allowance rather than one derived from a pool it may barely move.
    const slippageBps = explicitAddress
      ? this.config.maxSlippageBps
      : Math.min(
          this.config.maxSlippageBps,
          Math.max(this.config.slippageBps, Math.round(impactBps / 2) + this.config.slippageBps)
        );

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
    // No direct USDG pool: sell the dollars for ETH first, then buy with what
    // that produced. Two proven single-hop swaps beat one exotic route.
    let result;
    if (spend.convertTo) {
      // Two proven single-hop swaps: turn the funds into the currency this
      // token actually trades against, then buy with everything that produced
      // (minus the gas ETH must keep back).
      // Measured before and after, because the wallet may already hold some of
      // the currency being converted into. Spending the whole balance would
      // buy far more than the order asked for.
      const balanceBefore = spend.convertTo === NATIVE
        ? await this.chain.getEthBalance(wallet.address, { fresh: true })
        : (await this.chain.getTokenBalance(spend.convertTo, wallet.address)).raw;

      const converted = await this.dex.swap(signer, spend.tokenIn, spend.convertTo, spend.amountIn, {
        slippageBps: this.config.maxSlippageBps,
        maxSlippageBps: this.config.maxSlippageBps
      });

      const balanceAfter = spend.convertTo === NATIVE
        ? await this.chain.getEthBalance(wallet.address, { fresh: true })
        : (await this.chain.getTokenBalance(spend.convertTo, wallet.address)).raw;

      // Only what this conversion produced is available to spend. On the ETH
      // side the swap also paid gas out of the same balance, so the proceeds
      // are floored at zero and the reserve is kept back on top.
      let buyAmountIn = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0n;
      if (spend.convertTo === NATIVE) {
        const spendable = balanceAfter > gasReserve ? balanceAfter - gasReserve : 0n;
        if (buyAmountIn > spendable) buyAmountIn = spendable;
      }
      if (buyAmountIn <= 0n) {
        return {
          reply: `Converted your funds but there's nothing left to buy with. Send a little more and I'll finish it.`,
          txHash: converted.hash
        };
      }
      result = await this.dex.swap(signer, spend.convertTo, asset.address, buyAmountIn, { slippageBps, maxSlippageBps: this.config.maxSlippageBps });
    } else {
      result = await this.dex.swap(signer, spend.tokenIn, asset.address, spend.amountIn, { route, slippageBps, maxSlippageBps: this.config.maxSlippageBps });
    }
    const filled = Number(result.quotedOut) / 10 ** meta.decimals;
    this.logger.info(`Onchain buy: $${amountUsd} of ${asset.symbol} for author ${authorId}, tx ${result.hash}`);
    const provenance = borrowed && !asset.official ? ` (${asset.symbol} came from that tweet, not from me)` : "";
    // Say it out loud when the pool charged real money for the trade; silence
    // would leave the user to discover it in their balance.
    // A named contract is a decision already made, so the fill is reported
    // plainly with no lecture attached. Ticker buys still surface what the
    // pool charged, since the buyer never saw which pool they were getting.
    const cost = !explicitAddress && impactBps >= 100 ? ` Cost you ${(impactBps / 100).toFixed(1)}% in price impact.` : "";
    const warning = explicitAddress ? "" : exitWarning;
    return {
      reply: this.voice.say("filled", {
        amount: formatQty(filled),
        symbol: asset.symbol,
        usd: amountUsd,
        extra: `${provenance}${cost}${warning}`
      }),
      txHash: result.hash
    };
  }

  // What "portfolio" answers when on-chain mode is live: the real holdings,
  // laid out as a readable statement rather than a run-on sentence. No URL and
  // no address fragments: X charges 13x for a link and blocks crypto addresses.
  async describePortfolio(botUsername, authorId, username) {
    const wallet = await this.ensureWallet(botUsername, authorId, username);
    const [eth, holdings, ethUsd] = await Promise.all([
      this.chain.getEthBalance(wallet.address),
      this.fetchHoldings(wallet.address),
      this.dex.ethUsdPrice().catch(() => null)
    ]);
    const ethAmount = Number(formatEther(eth));
    const ethValue = ethUsd ? ethAmount * ethUsd : null;

    const rows = holdings.map((holding) => ({
      symbol: holding.symbol,
      amount: holding.amount,
      valueUsd: holding.valueUsd
    }));
    if (ethAmount > 0) rows.push({ symbol: "ETH", amount: ethAmount, valueUsd: ethValue });

    if (rows.length === 0) {
      return this.voice.say("emptyBag");
    }

    const total = rows.reduce((sum, row) => sum + (row.valueUsd ?? 0), 0);
    // A tweet is 280 characters, so the biggest positions are named and the
    // tail is counted rather than truncated mid-list.
    const ranked = rows.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
    const shown = ranked.slice(0, 4);
    const lines = shown.map((row) => `${row.symbol} ${formatCompact(row.amount)}${row.valueUsd ? ` · $${formatMoney(row.valueUsd)}` : ""}`);
    const rest = ranked.length - shown.length;
    if (rest > 0) lines.push(`+${rest} more`);
    return `Your bag: $${formatMoney(total)}\n${lines.join("\n")}\nManage it at the portfolio link in bio.`;
  }

  // Sells a holding back to ETH. The same wallet lock, the same route
  // discovery, the same slippage sizing as a buy: this is a buy in reverse.
  async handleSell(request) {
    return this.withWalletLock(request.authorId, () => this.executeSell(request));
  }

  async executeSell({ botUsername, authorId, username, intent, dryRun }) {
    const wallet = await this.ensureWallet(botUsername, authorId, username);
    const holdings = await this.fetchHoldings(wallet.address);
    if (holdings.length === 0) {
      return { reply: `You don't hold anything I can sell. Check the portfolio link in bio.` };
    }

    // Match by ticker or by address, whichever they gave.
    const term = String(intent.term ?? "").trim();
    const holding = term
      ? holdings.find((item) =>
          item.symbol.toUpperCase() === term.replace(/^\$/, "").toUpperCase() ||
          item.address.toLowerCase() === term.toLowerCase())
      : holdings[0];
    if (!holding) {
      return { reply: this.voice.say("nothingToSell", { symbol: term, held: holdings.slice(0, 3).map((item) => item.symbol).join(", ") }) };
    }

    const meta = await this.chain.getTokenMeta(holding.address);
    const balance = (await this.chain.getTokenBalance(holding.address, wallet.address)).raw;
    // A dollar figure is converted through the token's own price; otherwise
    // the portion applies, defaulting to the whole position.
    let amountIn = balance;
    if (intent.amountUsd && holding.priceUsd) {
      const tokens = intent.amountUsd / holding.priceUsd;
      amountIn = BigInt(Math.floor(tokens * 10 ** meta.decimals));
      if (amountIn > balance) amountIn = balance;
    } else if (intent.portion && intent.portion < 1) {
      amountIn = (balance * BigInt(Math.round(intent.portion * 1000))) / 1000n;
    }
    if (amountIn <= 0n) {
      return { reply: `That works out to zero ${holding.symbol}. Tell me a bigger slice.` };
    }

    const gasReserve = parseEther(String(this.config.gasReserveEth));
    if ((await this.chain.getEthBalance(wallet.address)) < gasReserve) {
      return { reply: this.voice.say("sellNoGas") };
    }

    // Sell into whichever quote currency this token actually trades against.
    const usdgAddress = this.dex.addresses.usdg;
    const [toEth, toUsdg] = await Promise.all([
      this.dex.findBestRoute(holding.address, NATIVE, amountIn).catch(() => null),
      this.dex.findBestRoute(holding.address, usdgAddress, amountIn).catch(() => null)
    ]);
    const route = toEth && (!toUsdg || toEth.amountOut > 0n) ? toEth : toUsdg;
    const proceedsIn = route === toEth ? NATIVE : usdgAddress;
    if (!route) {
      return { reply: `No one is buying ${holding.symbol} through the pools I can reach right now, so I can't sell it.` };
    }

    const sold = Number(amountIn) / 10 ** meta.decimals;
    if (dryRun) {
      return { reply: `[dry run] would sell ${formatCompact(sold)} ${holding.symbol} from ${wallet.address}.` };
    }

    const signer = this.vault.signerFor(wallet, this.chain.provider);
    const result = await this.dex.swap(signer, holding.address, proceedsIn, amountIn, {
      route,
      slippageBps: this.config.maxSlippageBps,
      maxSlippageBps: this.config.maxSlippageBps
    });
    const proceeds = proceedsIn === NATIVE
      ? `${formatEthAmount(Number(formatEther(result.quotedOut)))} ETH`
      : `$${formatMoney(Number(result.quotedOut) / 10 ** (await this.dex.usdgDecimals()))} USDG`;
    this.logger.info(`Onchain sell: ${sold} ${holding.symbol} for author ${authorId}, tx ${result.hash}`);
    return {
      reply: this.voice.say("sold", { amount: formatCompact(sold), symbol: holding.symbol, proceeds }),
      txHash: result.hash
    };
  }

  // Fills in price and liquidity for holdings the explorer never priced, in
  // one batched lookup against the pair index.
  async priceUnknownHoldings(holdings) {
    const unknown = holdings.filter((holding) => !holding.priceUsd).slice(0, 25);
    if (unknown.length === 0) return;
    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${unknown.map((holding) => holding.address).join(",")}`,
        { signal: AbortSignal.timeout(6_000) }
      );
      if (!response.ok) return;
      const body = await response.json();
      const best = new Map();
      for (const pair of body.pairs ?? []) {
        if (!String(pair.chainId ?? "").toLowerCase().includes("robinhood")) continue;
        const address = String(pair.baseToken?.address ?? "").toLowerCase();
        const liquidityUsd = Number(pair.liquidity?.usd ?? 0);
        const current = best.get(address);
        if (!current || liquidityUsd > current.liquidityUsd) {
          best.set(address, { priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null, liquidityUsd });
        }
      }
      for (const holding of unknown) {
        const match = best.get(holding.address.toLowerCase());
        if (!match) continue;
        holding.priceUsd = match.priceUsd;
        holding.liquidityUsd = match.liquidityUsd;
        holding.valueUsd = match.priceUsd ? holding.amount * match.priceUsd : null;
      }
    } catch (error) {
      // A pricing outage must not turn someone's holdings into spam.
      this.logger.warn?.(`Could not price unlisted holdings: ${error.message}`);
    }
  }

  // Ranks same-ticker candidates by what the chain says rather than what the
  // explorer claims: quote a real buy, then quote selling it straight back.
  // A token with no pool, or one rigged to swallow buys, scores nothing.
  // `probeWei` should be the amount actually about to be traded. A fixed probe
  // gets this wrong in both directions: too large and it condemns a pool that
  // handles the user's real (smaller) order perfectly well, too small and it
  // blesses one that cannot absorb the order at all.
  async pickByLiquidity(candidates, probeWei = 10n ** 15n) {
    const scored = await Promise.all(candidates.map(async (candidate) => {
      const inbound = await this.dex.findBestRoute(NATIVE, candidate.address, probeWei).catch(() => null);
      if (!inbound || inbound.amountOut === 0n) return null;
      const outbound = await this.dex.findBestRoute(candidate.address, NATIVE, inbound.amountOut).catch(() => null);
      if (!outbound || outbound.amountOut === 0n) return null;
      const retained = Number(outbound.amountOut) / Number(probeWei);
      // A memecoin can cost 50% to round trip and still be exactly what the
      // buyer wants, so this only screens out pools that give back close to
      // nothing. Choosing between same-ticker candidates is the job here; the
      // best of them wins on retention rather than on a threshold.
      return retained > 0.1 ? { candidate, retained } : null;
    }));
    const live = scored.filter(Boolean).sort((a, b) => b.retained - a.retained);
    return live[0]?.candidate ?? null;
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

    // The explorer prices almost nothing outside its own listings, so judging
    // spam on "has no price" hid tokens people had just bought through us.
    // Anything with real pair liquidity is a real holding, whatever the
    // explorer knows about it.
    await this.priceUnknownHoldings(all);
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
  // A token with a live market is a holding, full stop. Only things nobody
  // prices anywhere and nobody trades are treated as unsolicited junk.
  if (holding.priceUsd || holding.liquidityUsd > 0) return false;
  return !holding.icon;
}

function usdToWei(amountUsd, ethUsd) {
  return (BigInt(Math.round(amountUsd * 1e6)) * 10n ** 18n) / BigInt(Math.round(ethUsd * 1e6));
}

function formatEthAmount(value) {
  return Number(value.toFixed(5)).toString();
}

// Token counts run from 0.00004 to 40 billion, so the unit does the work
// rather than a wall of digits: 62.4K, 1.2M, 3.4B.
function formatCompact(value) {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) return `${trim(value / 1e9)}B`;
  if (magnitude >= 1e6) return `${trim(value / 1e6)}M`;
  if (magnitude >= 1e3) return `${trim(value / 1e3)}K`;
  if (magnitude >= 1) return trim(value);
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 }).format(value);
}

function trim(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2 }).format(value);
}

function formatMoney(value) {
  if (value >= 1000) return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatQty(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 1 ? 4 : 8 }).format(value);
}
