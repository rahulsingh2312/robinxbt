// Dumps the wallet database to a timestamped file. The encrypted keys live
// here and nowhere else, so a backup that is never taken is a total loss
// waiting for a disk failure. Run from cron; keep the output off this host.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";

const config = loadConfig();
if (!config.databaseUrl) throw new Error("Set DATABASE_URL before backing up");

const directory = path.resolve(process.env.BACKUP_DIR ?? "./backups");
await mkdir(directory, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(directory, `peterpan-${stamp}.sql`);

const dump = spawn("pg_dump", ["--no-owner", "--no-privileges", config.databaseUrl], { stdio: ["ignore", "pipe", "pipe"] });
dump.stdout.pipe(createWriteStream(target, { mode: 0o600 }));
dump.stderr.on("data", (chunk) => process.stderr.write(chunk));
dump.on("close", (code) => {
  if (code !== 0) {
    console.error(`pg_dump exited ${code}`);
    process.exit(code ?? 1);
  }
  console.info(`Wrote ${target}. Copy it OFF this host: the encrypted wallet keys are in it, and WALLET_ENC_KEY is not.`);
});
