import { Contract, JsonRpcProvider, formatEther, formatUnits, parseEther, parseUnits } from "ethers";

export const ROBINHOOD_CHAIN_ID = 4663;
export const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function transfer(address to, uint256 value) returns (bool)"
];

// Thin wrapper over the Robinhood Chain RPC. Token metadata is cached forever:
// decimals and symbol are immutable in practice, and every cache miss is a
// billed/rate-limited RPC round trip.
export class ChainClient {
  constructor({ rpcUrl = DEFAULT_RPC_URL, chainId = ROBINHOOD_CHAIN_ID } = {}) {
    // batchMaxCount groups concurrent eth_calls into one HTTP request, which
    // is what keeps a busy page from tripping the provider's rate limit.
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true, batchMaxCount: 20, batchStallTime: 10 });
    this.tokenMeta = new Map();
    this.balanceCache = new Map();
  }

  // Public RPC endpoints rate limit and occasionally drop connections. A read
  // that fails for those reasons is retried with backoff rather than surfacing
  // as "your wallet is empty".
  async withRetry(work, attempts = 3) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        lastError = error;
        const retryable = /429|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket|network|SERVER_ERROR/i.test(String(error.message ?? error));
        if (!retryable || attempt === attempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
      }
    }
    throw lastError;
  }

  erc20(address, runner = this.provider) {
    return new Contract(address, ERC20_ABI, runner);
  }

  // Cached for a few seconds: a page open in many tabs, or several viewers of
  // one popular wallet, must not multiply into RPC load. Short enough that a
  // deposit still shows up on the next poll.
  async getEthBalance(address, { fresh = false } = {}) {
    const key = `eth:${address.toLowerCase()}`;
    const hit = this.balanceCache.get(key);
    if (!fresh && hit && Date.now() - hit.at < 5_000) return hit.value;
    const value = await this.withRetry(() => this.provider.getBalance(address));
    this.balanceCache.set(key, { value, at: Date.now() });
    if (this.balanceCache.size > 5_000) this.balanceCache.clear();
    return value;
  }

  async getTokenMeta(address) {
    const key = address.toLowerCase();
    if (!this.tokenMeta.has(key)) {
      const token = this.erc20(address);
      const [decimals, symbol] = await this.withRetry(() => Promise.all([token.decimals(), token.symbol()]));
      this.tokenMeta.set(key, { decimals: Number(decimals), symbol });
    }
    return this.tokenMeta.get(key);
  }

  async getTokenBalance(tokenAddress, owner) {
    const [meta, raw] = await Promise.all([
      this.getTokenMeta(tokenAddress),
      this.withRetry(() => this.erc20(tokenAddress).balanceOf(owner))
    ]);
    return { raw, formatted: formatUnits(raw, meta.decimals), ...meta };
  }

  // Plain transfers used by the portfolio site's withdraw flow.
  async sendEth(signer, to, amountEth) {
    const tx = await signer.sendTransaction({ to, value: parseEther(String(amountEth)) });
    return tx.wait();
  }

  async sendToken(signer, tokenAddress, to, amount) {
    const meta = await this.getTokenMeta(tokenAddress);
    const tx = await this.erc20(tokenAddress, signer).transfer(to, parseUnits(String(amount), meta.decimals));
    return tx.wait();
  }
}

export { formatEther, parseEther };
