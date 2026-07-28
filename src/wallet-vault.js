import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Wallet } from "ethers";

// Custodial keys are the whole ballgame: whoever reads the store file or the
// database drains every user wallet. Keys are therefore AES-256-GCM encrypted
// with WALLET_ENC_KEY, which lives only in the environment — never alongside
// the ciphertext. Losing that key means losing every wallet, so back it up.
export class WalletVault {
  constructor(encKeyHex) {
    if (!/^[0-9a-fA-F]{64}$/.test(encKeyHex ?? "")) {
      throw new Error("WALLET_ENC_KEY must be 64 hex characters (32 bytes). Generate one: openssl rand -hex 32");
    }
    this.key = Buffer.from(encKeyHex, "hex");
  }

  encrypt(privateKey) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
    return { v: 1, iv: iv.toString("hex"), ct: ciphertext.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
  }

  decrypt(record) {
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(record.iv, "hex"));
    decipher.setAuthTag(Buffer.from(record.tag, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(record.ct, "hex")), decipher.final()]).toString("utf8");
  }

  // One wallet per numeric X author ID. The ID is the identity anchor —
  // handles change hands, and a re-registered handle must never inherit
  // someone else's funds. The username is stored only as a display/lookup
  // hint and is refreshed on every interaction.
  async ensureWallet(store, botUsername, authorId, xUsername) {
    const existing = await store.getWalletByAuthor(botUsername, String(authorId));
    if (existing) {
      if (xUsername && existing.xUsername !== xUsername.toLowerCase()) {
        existing.xUsername = xUsername.toLowerCase();
        await store.setWallet(botUsername, String(authorId), existing);
      }
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

  privateKeyOf(record) {
    return this.decrypt(record.key);
  }

  signerFor(record, provider) {
    return new Wallet(this.decrypt(record.key), provider);
  }
}
