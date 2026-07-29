// Every reply the trading path produces used to read like a receipt while the
// rest of the account was in character. The voice is the product, so the fills,
// refusals, and funding asks get it too.
//
// The rule for everything here: the numbers are untouchable. Framing is free,
// facts are not. No variant may add a claim the caller did not supply, and
// every variant must carry the same information as the plain one.

const PLAIN = {
  filled: ({ amount, symbol, usd, extra }) =>
    `Bought ~${amount} ${symbol} for $${usd}.${extra} It's in your wallet. Check the portfolio link in bio to see and manage your assets.`,
  sold: ({ amount, symbol, proceeds }) =>
    `Sold ${amount} ${symbol} for ${proceeds}. It's back in your wallet, check the portfolio link in bio.`,
  needsFunds: ({ shortfall, usd, where }) =>
    `Your wallet's short for that. Send ${shortfall} more ETH (or $${usd} USDG plus gas dust). ${where}, then tell me to buy again.`,
  needsGas: ({ usd, gas }) =>
    `You've got the $${usd} in USDG, but no ETH for gas. Send a little ETH on Robinhood Chain (${gas} covers it), then tell me to buy again.`,
  noMarket: ({ symbol }) =>
    `${symbol} has no tradable market at that size right now, so I can't buy it.`,
  honeypot: ({ symbol }) =>
    `${symbol} takes money in and gives almost nothing back out, which is what a honeypot looks like. Not buying it for you.`,
  tooThin: ({ symbol, percent, usd }) =>
    `Liquidity for ${symbol} is too thin: a $${usd} buy would lose ${percent}% to price impact. Not doing that to you.`,
  askAmount: ({ symbol }) =>
    `How much ${symbol}? Reply with a dollar amount like $25 and I'll fill it from your wallet.`,
  askAsset: () =>
    `Tell me what to buy: a ticker like $NVDA or a contract address, plus a dollar amount.`,
  overCap: ({ cap }) =>
    `That's over my per-order cap of $${cap}. Try a smaller size.`,
  emptyBag: () =>
    `Nothing in your wallet yet. Fund it from your portfolio page, link in bio, then tell me what to buy.`,
  nothingToSell: ({ symbol, held }) =>
    `You're not holding any ${symbol}. You have ${held}.`,
  sellNoGas: () =>
    `Selling costs gas and your wallet has none. Send a little ETH on Robinhood Chain, then ask again.`
};

// Same facts, in character. Kept to two or three options each: enough that the
// account does not read like a macro, few enough to stay recognisable.
const GORK = {
  filled: [
    ({ amount, symbol, usd, extra }) => `bought you ~${amount} ${symbol} for $${usd}.${extra} it's your bag now. portfolio link in bio, go stare at it.`,
    ({ amount, symbol, usd, extra }) => `done. ~${amount} ${symbol}, $${usd} of your money gone.${extra} in your wallet, link in bio. don't cry to me later.`,
    ({ amount, symbol, usd, extra }) => `filled. ~${amount} ${symbol} for $${usd}.${extra} it's in your wallet where i can't save you from it. link in bio.`
  ],
  sold: [
    ({ amount, symbol, proceeds }) => `sold your ${amount} ${symbol} for ${proceeds}. paper hands acknowledged. it's back in your wallet, link in bio.`,
    ({ amount, symbol, proceeds }) => `out. ${amount} ${symbol} became ${proceeds}. sitting in your wallet, link in bio.`
  ],
  needsFunds: [
    ({ shortfall, usd, where }) => `you're broke. ${shortfall} more ETH (or $${usd} USDG plus gas dust). ${where}, then ask again.`,
    ({ shortfall, usd, where }) => `wallet's empty, king. needs ${shortfall} more ETH, or $${usd} USDG and gas dust. ${where}, then tell me to buy.`
  ],
  needsGas: [
    ({ usd, gas }) => `you've got $${usd} in USDG and zero ETH for gas. classic. send ${gas} of ETH on robinhood chain and try me again.`,
    ({ usd, gas }) => `dollars yes, gas no. ${gas} of ETH on robinhood chain covers it, then ask again.`
  ],
  noMarket: [
    ({ symbol }) => `nothing is trading ${symbol} at that size right now. can't buy what nobody's selling.`,
    ({ symbol }) => `${symbol} has no market i can reach at that size. not my fault, but still your problem.`
  ],
  honeypot: [
    ({ symbol }) => `${symbol} takes money in and gives nothing back. that's a honeypot, not a token. hard no.`,
    ({ symbol }) => `you can buy ${symbol} and you can never sell it. that's called a trap. not doing it.`
  ],
  tooThin: [
    ({ symbol, percent, usd }) => `${symbol}'s pool would eat ${percent}% of your $${usd} on the way in. i'm not lighting your money on fire for content.`,
    ({ symbol, percent, usd }) => `$${usd} into ${symbol} loses ${percent}% to impact instantly. that's not a trade, that's a donation.`
  ],
  askAmount: [
    ({ symbol }) => `how much ${symbol}? say a number like $25 and it's done.`,
    ({ symbol }) => `${symbol}, sure. how much though. reply with a dollar amount.`
  ],
  askAsset: [
    () => `buy what exactly. give me a ticker like $NVDA or a contract address, and a dollar amount.`
  ],
  overCap: [
    ({ cap }) => `$${cap} per order is the cap. calm down.`,
    ({ cap }) => `that's over my $${cap} per-order limit. try a number that isn't rent.`
  ],
  emptyBag: [
    () => `your wallet is empty. fund it from the portfolio page, link in bio, then tell me what to buy.`,
    () => `nothing in there. put something in it from the portfolio page, link in bio, then we'll talk.`
  ],
  nothingToSell: [
    ({ symbol, held }) => `you don't own any ${symbol}. you own ${held}. sell one of those.`
  ],
  sellNoGas: [
    () => `selling costs gas and you have none. send a bit of ETH on robinhood chain and ask again.`
  ]
};

export class TradeVoice {
  constructor(persona = "default") {
    this.gork = persona === "gork";
  }

  say(key, values = {}) {
    const plain = PLAIN[key];
    if (!this.gork) return plain(values);
    const options = GORK[key];
    if (!options?.length) return plain(values);
    // Rotated per call rather than per process, so the same person asking
    // twice does not get the identical sentence back.
    return options[Math.floor(Math.random() * options.length)](values);
  }
}
