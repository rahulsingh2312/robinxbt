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
