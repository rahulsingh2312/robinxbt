export const metadata = { title: "How to talk to the bot · Peterpan" };

// Written as a phrasebook rather than a manual: people arrive here after the
// bot did something they did not expect, so every rule is shown as the actual
// message that produces it.
const BUYS = [
  ["buy $5 of NVDA", "A ticker and a dollar amount is all it needs."],
  ["i want you to buy 1.5 dollar of cashcat", "Say it however you like. Dollar, dollars, bucks, usd, all fine."],
  ["throw 20 bucks at PEPE", "Slang is fine too."],
  ["get me 5 dollars of tesla", "Company names work; it knows the tickers."],
  ["buy $3 of 0x020bfC65…18b4", "A contract address buys exactly that contract, no questions asked."],
  ["buy it, $10", "Replying under a tweet? It reads the tweet above for what “it” means."]
];

const SELLS = [
  ["sell my PEPE", "Sells the whole position back to ETH, straight from the tweet."],
  ["dump half my NVDA", "Half, a quarter, or all of it. Say which."],
  ["cash out $5 of cashcat", "Or name a dollar figure and it sells just that much."],
  ["show me my portfolio", "Lists what you hold, what it's worth, and the total."]
];

const ASKS = [
  ["buy me some NVDA", "No amount, so it asks how much. Reply “$5” and it fills."],
  ["ape into cashcat", "Same: it needs a size before it spends anything."]
];

const SKIPS = [
  ["should i buy NVDA?", "Questions get an opinion, never an order. Anything with a question mark is safe."],
  ["would you buy $50 of NVDA here?", "Still a question, even with an amount in it."],
  ["imagine buying $5 of that", "Hypotheticals and jokes are not orders."],
  ["what do you think of PEPE", "You get a take, not a trade."],
  ["withdraw my ETH", "Withdrawing to another address happens on your portfolio page, so a tweet can never move funds off your wallet."]
];

export default function Docs() {
  return (
    <main>
      <nav className="bar">
        <a className="wordmark" href="/"><img src="/pfp-peterpan.jpg" alt="" />peterpan.</a>
        <span className="pill">HOW IT READS YOU</span>
      </nav>

      <header className="hero" style={{ textAlign: "left", alignItems: "flex-start", gap: 10 }}>
        <p className="eyebrow">Talking to the bot</p>
        <h1 style={{ fontSize: "2.2rem" }}>What buys, and what doesn’t.</h1>
        <p className="muted" style={{ margin: 0, maxWidth: "58ch" }}>
          Mention @TryPeterpan and write like a person. It only spends money when
          you clearly tell it to, and it never spends more than what you deposited.
        </p>
      </header>

      <div className="divider"><span>These buy</span></div>
      <PhraseList items={BUYS} tone="yes" />

      <div className="divider"><span>These sell, or show your bag</span></div>
      <PhraseList items={SELLS} tone="yes" />

      <div className="divider"><span>These ask first</span></div>
      <PhraseList items={ASKS} tone="ask" />

      <div className="divider"><span>These never buy</span></div>
      <PhraseList items={SKIPS} tone="no" />

      <div className="divider"><span>Good to know</span></div>
      <div className="stack" style={{ gap: 18, maxWidth: "62ch" }}>
        <Note title="It spends your wallet, not a balance we hold">
          Buys come out of the wallet on your portfolio page. Fund it with ETH or
          USDG on Robinhood Chain, and keep a little ETH spare because every
          trade pays network gas in ETH.
        </Note>
        <Note title="Dollars and ETH both work">
          It picks whichever your wallet can cover, and converts between them
          when a token only trades against one of the two. You never have to
          choose.
        </Note>
        <Note title="Tickers are checked, contracts are trusted">
          A ticker has to resolve to a token with a real market, because anyone
          can name a token “NVDA”. A contract address is unambiguous, so it buys
          exactly that.
        </Note>
        <Note title="There is a per-order cap">
          Single orders are capped, and the bot answers a limited number of times
          per hour to each person. If you hit that, it tells you and picks back
          up shortly.
        </Note>
        <Note title="Buying and selling by tweet, withdrawing by hand">
          Trades happen in the conversation, both directions. Moving funds out
          of the wallet does not: sign in with X on your portfolio page to
          withdraw to any address, or to export your private key and take the
          wallet with you.
        </Note>
      </div>

      <div className="divider" aria-hidden="true"><span>· · ·</span></div>
      <p className="fineprint">
        <a href="/">Home</a> · <a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a>
      </p>
    </main>
  );
}

function PhraseList({ items, tone }) {
  return (
    <div className="phrases">
      {items.map(([phrase, explanation]) => (
        <div className={`phrase ${tone}`} key={phrase}>
          <p className="said">“{phrase}”</p>
          <p className="means">{explanation}</p>
        </div>
      ))}
    </div>
  );
}

function Note({ title, children }) {
  return (
    <section>
      <h2>{title}</h2>
      <p className="muted" style={{ margin: "6px 0 0" }}>{children}</p>
    </section>
  );
}
