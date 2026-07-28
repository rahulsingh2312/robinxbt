"use client";

import { use, useEffect, useState } from "react";

// One page, two modes: anyone can view a handle's holdings (they are public
// on-chain anyway), but the manage panel appears only when the signed-in X
// account matches the wallet's owner.
export default function PortfolioPage({ params }) {
  const { handle } = use(params);
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState(null);
  const [me, setMe] = useState(null);

  const refresh = () => {
    fetch(`/api/onchain/portfolio/${encodeURIComponent(handle)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error ?? "Failed to load");
        setPortfolio(await response.json());
      })
      .catch((cause) => setError(cause.message));
  };

  useEffect(() => {
    refresh();
    fetch("/api/onchain/me").then(async (response) => {
      if (response.ok) setMe(await response.json());
    }).catch(() => {});
  }, [handle]);

  if (error) {
    return (
      <main>
        <h1>@{handle}</h1>
        <p className="muted">{error}</p>
        <p>Mention the bot on X and a wallet appears here automatically.</p>
      </main>
    );
  }
  if (!portfolio) return <main><p className="muted">Loading…</p></main>;

  const owns = me?.username === portfolio.username;
  return (
    <main>
      <p className="eyebrow">ON-CHAIN PORTFOLIO · ROBINHOOD CHAIN</p>
      <h1>@{portfolio.username}</h1>
      <div className="card total">
        <span className="muted">Total value</span>
        <strong>{usd(portfolio.totalUsd)}</strong>
      </div>
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>Deposit address (send ETH on Robinhood Chain, chain id 4663)</p>
        <p className="address">{portfolio.address}</p>
        <p style={{ margin: 0 }}>
          <a href={portfolio.explorer} target="_blank" rel="noreferrer">View on explorer ↗</a>
        </p>
      </div>
      <table>
        <thead><tr><th>Asset</th><th>Amount</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td><strong>ETH</strong></td><td>{qty(portfolio.eth.amount)}</td><td>{usd(portfolio.eth.valueUsd)}</td></tr>
          {portfolio.tokens.map((token) => (
            <tr key={token.address}>
              <td><strong>{token.symbol}</strong><br /><span className="muted">{token.name}</span></td>
              <td>{qty(token.amount)}</td>
              <td>{usd(token.valueUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {owns ? <ManagePanel portfolio={portfolio} onChange={refresh} /> : (
        <div className="card">
          <p style={{ margin: 0 }}>
            Your wallet? <a href={`/auth/x/login?return=/u/${encodeURIComponent(handle)}`}>Sign in with X</a> to
            withdraw or export your key.
          </p>
        </div>
      )}

      <p className="risk">
        Balances read live from Robinhood Chain. Buys happen only by talking to the bot on X.
        Not investment advice; tokens can go to zero. Robinhood Stock Tokens are not offered to U.S. persons.
      </p>
    </main>
  );
}

function ManagePanel({ portfolio, onChange }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [revealed, setRevealed] = useState(null);
  const [form, setForm] = useState({ asset: "eth", to: "", amount: "" });

  const withdraw = async (event) => {
    event.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/onchain/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form)
      });
      const body = await response.json();
      setMessage(response.ok ? `Sent. Tx ${body.hash}` : body.error);
      if (response.ok) onChange();
    } finally {
      setBusy(false);
    }
  };

  const exportKey = async () => {
    if (!window.confirm("Your private key controls ALL funds in this wallet. Anyone who sees it can take everything. Reveal it now?")) return;
    const response = await fetch("/api/onchain/export-key", { method: "POST" });
    const body = await response.json();
    setRevealed(response.ok ? body.privateKey : null);
    setMessage(response.ok ? null : body.error);
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Manage</h2>
      <form className="row" onSubmit={withdraw}>
        <select value={form.asset} onChange={(event) => setForm({ ...form, asset: event.target.value })}>
          <option value="eth">ETH</option>
          {portfolio.tokens.map((token) => (
            <option key={token.address} value={token.address}>{token.symbol}</option>
          ))}
        </select>
        <input
          placeholder="0x destination address"
          value={form.to}
          onChange={(event) => setForm({ ...form, to: event.target.value })}
          style={{ flex: 1, minWidth: 260 }}
        />
        <input
          placeholder="amount"
          value={form.amount}
          onChange={(event) => setForm({ ...form, amount: event.target.value })}
          style={{ width: 110 }}
        />
        <button disabled={busy} type="submit">Withdraw</button>
      </form>
      <p style={{ marginBottom: 0 }}>
        <button className="danger" type="button" onClick={exportKey}>Export private key</button>
      </p>
      {revealed && (
        <>
          <p className="address">{revealed}</p>
          <p className="warn">Import it into a wallet you control, then treat this one as compromised convenience custody.</p>
        </>
      )}
      {message && <p className="muted">{message}</p>}
    </div>
  );
}

function usd(value) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function qty(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 1 ? 4 : 8 }).format(value);
}
