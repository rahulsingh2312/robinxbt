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
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.tokenMeta = new Map();
  }

  erc20(address, runner = this.provider) {
    return new Contract(address, ERC20_ABI, runner);
  }

  async getEthBalance(address) {
    return this.provider.getBalance(address);
  }

  async getTokenMeta(address) {
    const key = address.toLowerCase();
    if (!this.tokenMeta.has(key)) {
      const token = this.erc20(address);
      const [decimals, symbol] = await Promise.all([token.decimals(), token.symbol()]);
      this.tokenMeta.set(key, { decimals: Number(decimals), symbol });
    }
    return this.tokenMeta.get(key);
  }

  async getTokenBalance(tokenAddress, owner) {
    const [meta, raw] = await Promise.all([
      this.getTokenMeta(tokenAddress),
      this.erc20(tokenAddress).balanceOf(owner)
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
