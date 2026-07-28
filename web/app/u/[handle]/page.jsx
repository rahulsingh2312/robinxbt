"use client";

import { use, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

// A statement, not a dashboard: total first, deposit next (the loop people
// arrive here to close), holdings, then manage. Manage only renders for the
// signed-in owner; viewing is public because the chain already is.
export default function PortfolioPage({ params }) {
  const { handle } = use(params);
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState(null);
  const [me, setMe] = useState(null);

  const refresh = () => {
    fetch(`/api/onchain/portfolio/${encodeURIComponent(handle)}`)
      .then(async (response) => {
        // A non-JSON body means the proxy target is down or missing, not a
        // user-level error — say that instead of leaking a parse error.
        const body = await response.json().catch(() => {
          throw new Error("The portfolio API is unreachable right now. Try again in a minute.");
        });
        if (!response.ok) throw new Error(body.error ?? "Failed to load");
        setPortfolio(body);
      })
      .catch((cause) => setError(cause.message));
  };

  useEffect(() => {
    refresh();
    fetch("/api/onchain/me").then(async (response) => {
      if (response.ok) setMe(await response.json());
    }).catch(() => {});
  }, [handle]);

  return (
    <main>
      <nav className="bar">
        <a className="wordmark" href="/"><img src="/pfp-peterpan.jpg" alt="" />peterpan.</a>
        <span className="pill">CHAIN ID 4663</span>
      </nav>

      {error ? (
        <section className="hero" style={{ gap: 12 }}>
          <Avatar handle={handle} />
          <h1 style={{ fontSize: "1.8rem" }}>@{handle}</h1>
          <p className="muted" style={{ margin: 0 }}>{error}</p>
          <p style={{ margin: 0 }}>Mention @TryPeterpan on X and a wallet appears here on its own.</p>
        </section>
      ) : !portfolio ? (
        <LoadingStatement handle={handle} />
      ) : (
        <Statement
          portfolio={portfolio}
          me={me}
          onChange={refresh}
          onSignOut={async () => {
            await fetch("/auth/logout", { method: "POST" }).catch(() => {});
            setMe(null);
          }}
        />
      )}

      <div className="divider" aria-hidden="true"><span>· · ·</span></div>

      <p className="fineprint">
        Balances read live from Robinhood Chain. Buys happen only by talking to
        the bot on X. Not investment advice; tokens can go to zero. Robinhood
        Stock Tokens are not offered to U.S., Canadian, UK, or Swiss persons.
      </p>
    </main>
  );
}

// The user's live X profile picture; falls back to a monogram disc.
function Avatar({ handle }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="owner" aria-hidden="true">
        <div style={{ width: 46, height: 46, borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--edge)", display: "grid", placeItems: "center", fontWeight: 650 }}>
          {handle.slice(0, 1).toUpperCase()}
        </div>
      </div>
    );
  }
  return <img src={`https://unavatar.io/x/${encodeURIComponent(handle)}`} alt="" onError={() => setFailed(true)} style={{ width: 46, height: 46, borderRadius: 999, border: "1px solid var(--edge)", background: "var(--surface-2)" }} />;
}

function LoadingStatement({ handle }) {
  return (
    <section className="stack" style={{ gap: 20 }} aria-busy="true">
      <div className="owner">
        <Avatar handle={handle} />
        <div className="handle">@{handle}<small>ON-CHAIN PORTFOLIO</small></div>
      </div>
      <div className="statement">
        <div className="skeleton" style={{ width: 220, height: 56, margin: "0 auto" }} />
      </div>
      <div className="card stack" style={{ gap: 10 }}>
        <div className="skeleton" style={{ width: "50%" }} />
        <div className="skeleton" style={{ width: "100%" }} />
      </div>
    </section>
  );
}

function Statement({ portfolio, me, onChange, onSignOut }) {
  const owns = me?.username === portfolio.username;
  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="spread">
        <div className="owner">
          <Avatar handle={portfolio.username} />
          <div className="handle">@{portfolio.username}<small>ON-CHAIN PORTFOLIO</small></div>
        </div>
        {owns ? (
          <button className="quiet" type="button" onClick={onSignOut}>Sign out</button>
        ) : me ? (
          <div className="row" style={{ gap: 8 }}>
            <a className="btn-quiet" href={`/u/${encodeURIComponent(me.username)}`}>My portfolio</a>
            <button className="quiet" type="button" onClick={onSignOut}>Sign out</button>
          </div>
        ) : (
          <a className="btn-quiet" href={`/auth/x/login?return=/u/${encodeURIComponent(portfolio.username)}`}>
            Your wallet? Sign in with 𝕏
          </a>
        )}
      </div>

      <section className="statement">
        <p className="eyebrow" style={{ margin: "0 0 10px" }}>Total value</p>
        <div className="total-figure">{usd(portfolio.totalUsd)}</div>
        <p className="muted num under" style={{ fontSize: "0.82rem" }}>
          {qty(portfolio.eth.amount)} ETH · {portfolio.tokens.length} token{portfolio.tokens.length === 1 ? "" : "s"} · live from chain
        </p>
      </section>

      <DepositCard address={portfolio.address} explorer={portfolio.explorer} />

      <section className="card stack" style={{ gap: 6 }}>
        <div className="spread" style={{ marginBottom: 8 }}>
          <h2>Holdings</h2>
          <span className="pill">LIVE</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Asset</th><th>Amount</th><th>Value</th></tr></thead>
            <tbody>
              <tr>
                <td><div className="asset"><span className="tick">ETH</span></div></td>
                <td className="num">{qty(portfolio.eth.amount)}</td>
                <td className="num">{usd(portfolio.eth.valueUsd)}</td>
              </tr>
              {portfolio.tokens.map((token) => (
                <tr key={token.address}>
                  <td>
                    <div className="asset">
                      {token.icon ? <img src={token.icon} alt="" /> : null}
                      <span>
                        <span className="tick">{token.symbol}</span>
                        <small>{token.name}</small>
                      </span>
                    </div>
                  </td>
                  <td className="num">{qty(token.amount)}</td>
                  <td className="num">{usd(token.valueUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {owns && <ManagePanel portfolio={portfolio} onChange={onChange} />}
    </div>
  );
}

function DepositCard({ address, explorer }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, address, { width: 132, margin: 0 }).catch(() => {});
    }
  }, [address]);

  return (
    <section className="card stack" style={{ gap: 14 }}>
      <div className="spread">
        <h2>Deposit</h2>
        <span className="pill">ETH OR USDG · ROBINHOOD CHAIN ONLY</span>
      </div>
      <div className="row" style={{ alignItems: "flex-start", gap: 18 }}>
        <div className="qr-box"><canvas ref={canvasRef} /></div>
        <div className="stack" style={{ gap: 10, flex: 1, minWidth: 220 }}>
          <div className="address">{address}</div>
          <div className="row">
            <button
              className="quiet"
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied ✓" : "Copy address"}
            </button>
            <a href={explorer} target="_blank" rel="noreferrer">Explorer ↗</a>
          </div>
          <p className="warn-text" style={{ margin: 0 }}>
            Send only on Robinhood Chain (chain id 4663). Funds sent on other networks are gone.
          </p>
        </div>
      </div>
    </section>
  );
}

function ManagePanel({ portfolio, onChange }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [revealed, setRevealed] = useState(null);
  const [sell, setSell] = useState({ token: "", amount: "" });
  const [withdrawForm, setWithdrawForm] = useState({ asset: "eth", to: "", amount: "" });

  const post = async (path, body) => {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      setMessage(response.ok ? `Done. Tx ${payload.hash}` : payload.error);
      if (response.ok) onChange();
      return response.ok;
    } finally {
      setBusy(false);
    }
  };

  const sellable = portfolio.tokens.filter((token) => token.amount > 0);

  return (
    <section className="card stack" style={{ gap: 20 }}>
      <h2>Manage</h2>

      {sellable.length > 0 && (
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            if (sell.token && Number(sell.amount) > 0) post("/api/onchain/sell", sell);
          }}
        >
          <select
            value={sell.token}
            onChange={(event) => setSell({ ...sell, token: event.target.value })}
            aria-label="Token to sell"
          >
            <option value="">Sell…</option>
            {sellable.map((token) => (
              <option key={token.address} value={token.address}>{token.symbol}</option>
            ))}
          </select>
          <input
            className="num"
            placeholder="amount"
            value={sell.amount}
            onChange={(event) => setSell({ ...sell, amount: event.target.value })}
            style={{ width: 130 }}
            aria-label="Sell amount"
          />
          <button
            className="quiet"
            type="button"
            disabled={!sell.token}
            onClick={() => {
              const token = sellable.find((candidate) => candidate.address === sell.token);
              if (token) setSell({ ...sell, amount: String(token.amount) });
            }}
          >
            Max
          </button>
          <button disabled={busy} type="submit">Sell for ETH</button>
        </form>
      )}

      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          post("/api/onchain/withdraw", withdrawForm);
        }}
      >
        <select
          value={withdrawForm.asset}
          onChange={(event) => setWithdrawForm({ ...withdrawForm, asset: event.target.value })}
          aria-label="Asset to withdraw"
        >
          <option value="eth">ETH</option>
          {portfolio.tokens.map((token) => (
            <option key={token.address} value={token.address}>{token.symbol}</option>
          ))}
        </select>
        <input
          placeholder="0x destination"
          value={withdrawForm.to}
          onChange={(event) => setWithdrawForm({ ...withdrawForm, to: event.target.value })}
          style={{ flex: 1, minWidth: 240 }}
          aria-label="Destination address"
        />
        <input
          className="num"
          placeholder="amount"
          value={withdrawForm.amount}
          onChange={(event) => setWithdrawForm({ ...withdrawForm, amount: event.target.value })}
          style={{ width: 130 }}
          aria-label="Withdraw amount"
        />
        <button disabled={busy} type="submit">Withdraw</button>
      </form>

      <div className="stack" style={{ gap: 8 }}>
        <div className="row">
          <button
            className="danger"
            type="button"
            onClick={async () => {
              if (!window.confirm("Your private key controls ALL funds in this wallet. Anyone who sees it can take everything. Reveal it now?")) return;
              const response = await fetch("/api/onchain/export-key", { method: "POST" });
              const payload = await response.json();
              if (response.ok) { setRevealed(payload.privateKey); setMessage(null); }
              else setMessage(payload.error);
            }}
          >
            Export private key
          </button>
        </div>
        {revealed && (
          <>
            <div className="address">{revealed}</div>
            <p className="warn-text" style={{ margin: 0 }}>
              Import it into a wallet you control, then treat this one as compromised convenience custody.
            </p>
          </>
        )}
      </div>

      {message && <p className={message.startsWith("Done") ? "muted num" : "error-text"} style={{ margin: 0, wordBreak: "break-all" }}>{message}</p>}
    </section>
  );
}

function usd(value) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function qty(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 1 ? 4 : 8 }).format(value);
}
