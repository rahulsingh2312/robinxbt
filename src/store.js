import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const EMPTY_STORE = { users: {}, state: {} };

export class Store {
  constructor(file) {
    this.file = file;
    this.data = structuredClone(EMPTY_STORE);
    this.pendingWrite = Promise.resolve();
  }

  async load() {
    await mkdir(dirname(this.file), { recursive: true });
    try {
      this.data = JSON.parse(await readFile(this.file, "utf8"));
      this.data.users ??= {};
      this.data.state ??= {};
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.save();
    }
  }

  async save() {
    const content = JSON.stringify(this.data, null, 2);
    this.pendingWrite = this.pendingWrite.then(async () => {
      const temporaryFile = `${this.file}.tmp`;
      await writeFile(temporaryFile, content, { mode: 0o600 });
      await rename(temporaryFile, this.file);
    });
    return this.pendingWrite;
  }

  userKey(botUsername, username) {
    return `${botUsername.toLowerCase()}:${username.toLowerCase()}`;
  }

  async getUser(botUsername, username) {
    return this.data.users[this.userKey(botUsername, username)] ?? null;
  }

  async setUser(botUsername, username, user) {
    this.data.users[this.userKey(botUsername, username)] = user;
    await this.save();
  }

  async getLastMentionId(botUsername) {
    return this.data.state[botUsername.toLowerCase()]?.lastMentionId ?? null;
  }

  async setLastMentionId(botUsername, id) {
    this.data.state[botUsername.toLowerCase()] = { lastMentionId: id };
    await this.save();
  }
}
