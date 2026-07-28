// Re-encrypts every stored wallet under the current WALLET_ENC_KEY, reading
// any record still sealed under WALLET_ENC_KEY_PREVIOUS. Run once after
// rotating the key, then remove WALLET_ENC_KEY_PREVIOUS from the environment.
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { PostgresStore } from "./postgres-store.js";
import { WalletVault } from "./wallet-vault.js";

const config = loadConfig();
if (!config.onchain.enabled) throw new Error("ONCHAIN_ENABLED must be true to rewrap wallets");
if (!config.onchain.previousWalletEncKey) throw new Error("Set WALLET_ENC_KEY_PREVIOUS to the old key before rewrapping");

const store = config.databaseUrl ? new PostgresStore(config.databaseUrl) : new Store(config.dataFile);
await store.load();
const vault = new WalletVault(config.onchain.walletEncKey, config.onchain.previousWalletEncKey);

const botUsername = config.bots[0].botUsername;
const rewrapped = await vault.rewrapAll(store, botUsername);
console.info(`Rewrapped ${rewrapped} wallet(s) under the current WALLET_ENC_KEY. Remove WALLET_ENC_KEY_PREVIOUS now.`);
await store.close?.();
