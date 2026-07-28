import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Wallet } from "ethers";

// A record that does not match this exactly is corrupt or tampered with, and
// must never reach the cipher.
function assertRecordShape(record) {
  const key = record?.key ?? record;
  if (key?.v !== 1 || !/^[0-9a-f]{24}$/i.test(key.iv ?? "") || !/^[0-9a-f]{32}$/i.test(key.tag ?? "") || !/^[0-9a-f]+$/i.test(key.ct ?? "")) {
    throw new Error("Stored wallet key record is malformed");
  }
}

// Custodial keys are the whole ballgame: whoever reads the store file or the
// database drains every user wallet. Keys are therefore AES-256-GCM encrypted
// with WALLET_ENC_KEY, which lives only in the environment — never alongside
// the ciphertext. Losing that key means losing every wallet, so back it up.
export class WalletVault {
  // `previousKeyHex` exists so an encryption key can actually be rotated:
  // records written under the old key stay readable, and every read re-writes
  // them under the new one. Without it, rotating WALLET_ENC_KEY would make
  // every wallet permanently unspendable.
  constructor(encKeyHex, previousKeyHex = "") {
    if (!/^[0-9a-fA-F]{64}$/.test(encKeyHex ?? "")) {
      throw new Error("WALLET_ENC_KEY must be 64 hex characters (32 bytes). Generate one: openssl rand -hex 32");
    }
    if (previousKeyHex && !/^[0-9a-fA-F]{64}$/.test(previousKeyHex)) {
      throw new Error("WALLET_ENC_KEY_PREVIOUS must be 64 hex characters (32 bytes)");
    }
    this.key = Buffer.from(encKeyHex, "hex");
    this.previousKey = previousKeyHex ? Buffer.from(previousKeyHex, "hex") : null;
  }

  encrypt(privateKey) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
    return { v: 1, iv: iv.toString("hex"), ct: ciphertext.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
  }

  decrypt(recordOrKey) {
    const record = recordOrKey?.key ?? recordOrKey;
    assertRecordShape(record);
    try {
      return this.decryptWith(this.key, record);
    } catch (error) {
      // Only a wrong key looks like this; with the previous key configured,
      // a record written before rotation still opens.
      if (!this.previousKey) throw error;
      return this.decryptWith(this.previousKey, record);
    }
  }

  // authTagLength is pinned: without it Node accepts a truncated tag, which
  // would let anyone able to WRITE the store weaken the forgery bound.
  decryptWith(key, record) {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "hex"), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(record.tag, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(record.ct, "hex")), decipher.final()]).toString("utf8");
  }

  // True when the record is still sealed under the retired key, so callers
  // can re-encrypt it in place as they touch it.
  needsRewrap(record) {
    if (!this.previousKey) return false;
    try {
      this.decryptWith(this.key, record);
      return false;
    } catch {
      return true;
    }
  }

  // One wallet per numeric X author ID. The ID is the identity anchor —
  // handles change hands, and a re-registered handle must never inherit
  // someone else's funds. The username is stored only as a display/lookup
  // hint and is refreshed on every interaction.
  async ensureWallet(store, botUsername, authorId, xUsername) {
    const existing = await store.getWalletByAuthor(botUsername, String(authorId));
    if (existing) {
      let dirty = false;
      if (xUsername && existing.xUsername !== xUsername.toLowerCase()) {
        existing.xUsername = xUsername.toLowerCase();
        dirty = true;
      }
      // Lazy migration: a wallet still sealed under the retired key gets
      // re-sealed the next time its owner interacts, so rotation completes
      // itself without a maintenance window.
      if (this.needsRewrap(existing)) {
        existing.key = this.encrypt(this.decrypt(existing));
        dirty = true;
      }
      if (dirty) await store.setWallet(botUsername, String(authorId), existing);
      return { ...existing, created: false };
    }
    const wallet = Wallet.createRandom();
    const record = {
      address: wallet.address,
      xUsername: (xUsername ?? "").toLowerCase(),
      key: this.encrypt(wallet.privateKey),
      createdAt: new Date().toISOString()
    };
    await store.setWallet(botUsername, String(authorId), record);
    return { ...record, created: true };
  }

  // Re-encrypts every stored wallet under the current key. Run once after
  // setting WALLET_ENC_KEY_PREVIOUS, then drop that variable.
  async rewrapAll(store, botUsername) {
    if (!store.listWallets) throw new Error("This store cannot enumerate wallets");
    let rewrapped = 0;
    for (const { authorId, record } of await store.listWallets(botUsername)) {
      if (!this.needsRewrap(record)) continue;
      await store.setWallet(botUsername, authorId, { ...record, key: this.encrypt(this.decrypt(record)) });
      rewrapped += 1;
    }
    return rewrapped;
  }

  privateKeyOf(record) {
    return this.decrypt(record.key);
  }

  signerFor(record, provider) {
    return new Wallet(this.decrypt(record.key), provider);
  }
}
