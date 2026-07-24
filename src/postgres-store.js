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
