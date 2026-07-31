import pg from "pg";

const { Pool } = pg;

export class PostgresStore {
  constructor(databaseUrl) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async load() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS xbot_users (
        bot_username TEXT NOT NULL,
        x_username TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (bot_username, x_username)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS xbot_state (
        bot_username TEXT PRIMARY KEY,
        last_mention_id TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS xbot_orders (
        bot_username TEXT NOT NULL,
        post_id TEXT NOT NULL,
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (bot_username, post_id)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS xbot_handled (
        bot_username TEXT NOT NULL,
        post_id TEXT NOT NULL,
        handled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (bot_username, post_id)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS xbot_paper (
        bot_username TEXT NOT NULL,
        user_id TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (bot_username, user_id)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS xbot_wallets (
        bot_username TEXT NOT NULL,
        author_id TEXT NOT NULL,
        x_username TEXT,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (bot_username, author_id)
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS xbot_wallets_by_username
      ON xbot_wallets (bot_username, x_username)
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS xbot_baskets (
        bot_username TEXT NOT NULL,
        post_id TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (bot_username, post_id)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS xbot_pending_buys (
        bot_username TEXT NOT NULL,
        post_id TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (bot_username, post_id)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS xbot_replies (
        bot_username TEXT NOT NULL,
        author_id TEXT NOT NULL,
        replied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS xbot_replies_recent ON xbot_replies (bot_username, replied_at DESC)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS xbot_replies_author ON xbot_replies (bot_username, author_id, replied_at DESC)
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS xbot_spend (
        bot_username TEXT NOT NULL,
        day DATE NOT NULL,
        spent_usd NUMERIC NOT NULL DEFAULT 0,
        PRIMARY KEY (bot_username, day)
      )
    `);
  }

  // INSERT ... ON CONFLICT DO NOTHING is atomic, so two workers racing on the
  // same mention can never both place the order.
  async claimOrder(botUsername, postId) {
    const result = await this.pool.query(
      `INSERT INTO xbot_orders (bot_username, post_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING post_id`,
      [botUsername.toLowerCase(), String(postId)]
    );
    return result.rowCount > 0;
  }

  async claimMention(botUsername, postId) {
    const result = await this.pool.query(
      `INSERT INTO xbot_handled (bot_username, post_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING post_id`,
      [botUsername.toLowerCase(), String(postId)]
    );
    return result.rowCount > 0;
  }

  async releaseMention(botUsername, postId) {
    await this.pool.query(
      "DELETE FROM xbot_handled WHERE bot_username = $1 AND post_id = $2",
      [botUsername.toLowerCase(), String(postId)]
    );
  }

  async getPaperBook(botUsername, userId) {
    const result = await this.pool.query(
      "SELECT data FROM xbot_paper WHERE bot_username = $1 AND user_id = $2",
      [botUsername.toLowerCase(), String(userId)]
    );
    return result.rows[0]?.data ?? null;
  }

  async setPaperBook(botUsername, userId, book) {
    await this.pool.query(
      `INSERT INTO xbot_paper (bot_username, user_id, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (bot_username, user_id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [botUsername.toLowerCase(), String(userId), JSON.stringify(book)]
    );
  }

  async recordSpend(botUsername, day, amountUsd) {
    await this.pool.query(
      `INSERT INTO xbot_spend (bot_username, day, spent_usd) VALUES ($1, $2, $3)
       ON CONFLICT (bot_username, day)
       DO UPDATE SET spent_usd = xbot_spend.spent_usd + EXCLUDED.spent_usd`,
      [botUsername.toLowerCase(), day, amountUsd]
    );
  }

  async getSpend(botUsername, day) {
    const result = await this.pool.query(
      "SELECT spent_usd FROM xbot_spend WHERE bot_username = $1 AND day = $2",
      [botUsername.toLowerCase(), day]
    );
    return Number(result.rows[0]?.spent_usd ?? 0);
  }

  async getUser(botUsername, username) {
    const result = await this.pool.query(
      "SELECT data FROM xbot_users WHERE bot_username = $1 AND x_username = $2",
      [botUsername.toLowerCase(), username.toLowerCase()]
    );
    return result.rows[0]?.data ?? null;
  }

  async setUser(botUsername, username, user) {
    await this.pool.query(
      `INSERT INTO xbot_users (bot_username, x_username, data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (bot_username, x_username)
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [botUsername.toLowerCase(), username.toLowerCase(), JSON.stringify(user)]
    );
  }

  async getWalletByAuthor(botUsername, authorId) {
    const result = await this.pool.query(
      "SELECT data FROM xbot_wallets WHERE bot_username = $1 AND author_id = $2",
      [botUsername.toLowerCase(), String(authorId)]
    );
    return result.rows[0]?.data ?? null;
  }

  // Returns the stored record, inserting only if this author has none. The
  // insert is atomic, so concurrent mentions from a brand-new user converge on
  // one wallet instead of overwriting each other's keys.
  async createWalletIfAbsent(botUsername, authorId, record) {
    const inserted = await this.pool.query(
      `INSERT INTO xbot_wallets (bot_username, author_id, x_username, data)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (bot_username, author_id) DO NOTHING
       RETURNING data`,
      [botUsername.toLowerCase(), String(authorId), record.xUsername ?? null, JSON.stringify(record)]
    );
    if (inserted.rowCount > 0) return { record: inserted.rows[0].data, created: true };
    return { record: await this.getWalletByAuthor(botUsername, authorId), created: false };
  }

  // Serializes work across every process talking to this database, so a
  // second instance cannot sign a transaction with the same nonce.
  async withAdvisoryLock(key, work) {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [String(key)]);
      return await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [String(key)]).catch(() => {});
      client.release();
    }
  }

  async setWallet(botUsername, authorId, record) {
    await this.pool.query(
      `INSERT INTO xbot_wallets (bot_username, author_id, x_username, data)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (bot_username, author_id)
       DO UPDATE SET data = EXCLUDED.data, x_username = EXCLUDED.x_username, updated_at = now()`,
      [botUsername.toLowerCase(), String(authorId), record.xUsername ?? null, JSON.stringify(record)]
    );
  }

  async listWallets(botUsername) {
    const result = await this.pool.query(
      "SELECT author_id, data FROM xbot_wallets WHERE bot_username = $1",
      [botUsername.toLowerCase()]
    );
    return result.rows.map((row) => ({ authorId: row.author_id, record: row.data }));
  }

  async getWalletByUsername(botUsername, xUsername) {
    const result = await this.pool.query(
      `SELECT author_id, data FROM xbot_wallets
       WHERE bot_username = $1 AND x_username = $2
       ORDER BY updated_at DESC LIMIT 1`,
      [botUsername.toLowerCase(), xUsername.toLowerCase()]
    );
    const row = result.rows[0];
    if (!row) return null;
    // Only the wallet that currently claims this handle may answer for it.
    if (row.data?.xUsername && row.data.xUsername !== xUsername.toLowerCase()) return null;
    return { ...row.data, authorId: row.author_id };
  }

  // A basket proposed in a reply, keyed by the bot's own post. These existed
  // only on the JSON store, so every mention that reached the confirm path
  // threw once production moved to Postgres — and a thrown handler answers
  // nobody.
  async savePendingBasket(botUsername, postId, basket) {
    await this.pool.query(
      `INSERT INTO xbot_baskets (bot_username, post_id, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (bot_username, post_id) DO UPDATE SET data = EXCLUDED.data`,
      [botUsername.toLowerCase(), String(postId), JSON.stringify(basket)]
    );
  }

  async getPendingBasket(botUsername, postId) {
    const result = await this.pool.query(
      "SELECT data FROM xbot_baskets WHERE bot_username = $1 AND post_id = $2",
      [botUsername.toLowerCase(), String(postId)]
    );
    return result.rows[0]?.data ?? null;
  }

  async clearPendingBasket(botUsername, postId) {
    await this.pool.query(
      "DELETE FROM xbot_baskets WHERE bot_username = $1 AND post_id = $2",
      [botUsername.toLowerCase(), String(postId)]
    );
  }

  async savePendingBuy(botUsername, postId, buy) {
    await this.pool.query(
      `INSERT INTO xbot_pending_buys (bot_username, post_id, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (bot_username, post_id) DO UPDATE SET data = EXCLUDED.data`,
      [botUsername.toLowerCase(), String(postId), JSON.stringify(buy)]
    );
  }

  async getPendingBuy(botUsername, postId) {
    const result = await this.pool.query(
      "SELECT data FROM xbot_pending_buys WHERE bot_username = $1 AND post_id = $2",
      [botUsername.toLowerCase(), String(postId)]
    );
    return result.rows[0]?.data ?? null;
  }

  async clearPendingBuy(botUsername, postId) {
    await this.pool.query(
      "DELETE FROM xbot_pending_buys WHERE bot_username = $1 AND post_id = $2",
      [botUsername.toLowerCase(), String(postId)]
    );
  }

  async recordReplyAt(botUsername, authorId) {
    await this.pool.query(
      "INSERT INTO xbot_replies (bot_username, author_id) VALUES ($1, $2)",
      [botUsername.toLowerCase(), String(authorId ?? "")]
    );
    // Cheap opportunistic prune; the counters only ever look back a day.
    if (Math.floor(Date.now() / 1000) % 50 === 0) {
      await this.pool.query("DELETE FROM xbot_replies WHERE replied_at < now() - interval '2 days'");
    }
  }

  async countReplies(botUsername, authorId) {
    const result = await this.pool.query(
      `SELECT
         count(*) FILTER (WHERE replied_at > now() - interval '1 day')::int AS day,
         count(*) FILTER (WHERE author_id = $2 AND replied_at > now() - interval '1 hour')::int AS author_hour
       FROM xbot_replies WHERE bot_username = $1`,
      [botUsername.toLowerCase(), String(authorId ?? "")]
    );
    return { day: result.rows[0].day, authorHour: result.rows[0].author_hour };
  }

  async getLastMentionId(botUsername) {
    const result = await this.pool.query("SELECT last_mention_id FROM xbot_state WHERE bot_username = $1", [botUsername.toLowerCase()]);
    return result.rows[0]?.last_mention_id ?? null;
  }

  async setLastMentionId(botUsername, id) {
    await this.pool.query(
      `INSERT INTO xbot_state (bot_username, last_mention_id)
       VALUES ($1, $2)
       ON CONFLICT (bot_username)
       DO UPDATE SET last_mention_id = EXCLUDED.last_mention_id, updated_at = now()`,
      [botUsername.toLowerCase(), id]
    );
  }

  async close() {
    await this.pool.end();
  }
}
