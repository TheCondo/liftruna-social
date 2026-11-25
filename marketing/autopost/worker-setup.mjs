// Sets up the LiftRuna posts Worker on Cloudflare (D86). Run once, after
// `npx wrangler@4 login` (Connor signs in to his free Cloudflare account):
//   node marketing/autopost/worker-setup.mjs
// It creates the storage, deploys the Worker, gives it its secrets (read
// from .env.local, never printed), points the Telegram bot at it, and saves
// WORKER_URL and DRAFTS_SECRET in .env.local. Safe to run again.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const config = "marketing/autopost/worker/wrangler.toml";
process.loadEnvFile(".env.local");

function wrangler(args, input) {
  const out = spawnSync("npx", ["--yes", "wrangler@4", ...args, "--config", config], { input, encoding: "utf8", shell: true });
  if (out.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed:\n${out.stderr || out.stdout}`);
  return out.stdout + out.stderr;
}
function saveEnv(name, value) {
  const env = readFileSync(".env.local", "utf8");
  appendFileSync(".env.local", `${env.endsWith("\n") ? "" : "\n"}${name}=${value}\n`);
  process.env[name] = value;
}

for (const name of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]) {
  if (!process.env[name]) throw new Error(`${name} missing from .env.local: run telegram-setup.mjs first`);
}
if (!process.env.WEBHOOK_SECRET) saveEnv("WEBHOOK_SECRET", randomBytes(24).toString("hex"));
if (!process.env.DRAFTS_SECRET) saveEnv("DRAFTS_SECRET", randomBytes(24).toString("hex"));

// 1. Storage.
let toml = readFileSync(config, "utf8");
if (toml.includes("REPLACED_BY_SETUP")) {
  const out = wrangler(["kv", "namespace", "create", "POSTS"]);
  const id = out.match(/"?id"?\s*[=:]\s*"([0-9a-f]{32})"/)?.[1];
  if (!id) throw new Error(`Could not read the storage id from:\n${out}`);
  toml = toml.replace("REPLACED_BY_SETUP", id);
  writeFileSync(config, toml);
  console.log("Storage created.");
}

// 2. Deploy, then learn the Worker's address.
let out = wrangler(["deploy"]);
const url = out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/)?.[0];
if (!url) throw new Error(`Could not find the Worker's address in:\n${out}`);
console.log(`Worker: ${url}`);
if (!toml.includes(`PUBLIC_ORIGIN = "${url}"`)) {
  toml = toml.replace(/PUBLIC_ORIGIN = ".*"/, `PUBLIC_ORIGIN = "${url}"`);
  writeFileSync(config, toml);
  out = wrangler(["deploy"]);
}

// 3. Secrets (piped in, never shown).
for (const name of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "WEBHOOK_SECRET", "DRAFTS_SECRET"]) {
  wrangler(["secret", "put", name], process.env[name]);
}
console.log("Secrets set.");
if (process.env.WORKER_URL !== url) saveEnv("WORKER_URL", url);

// 4. Telegram sends taps and messages to the Worker from now on.
const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: `${url}/telegram`, secret_token: process.env.WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: true }),
});
const hook = await res.json();
if (!hook.ok) throw new Error(`Telegram setWebhook: ${hook.description}`);
console.log("Telegram now talks to the Worker.");

await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: "Instant replies are on ⚡ From now on your taps are handled straight away, even when your computers are off." }),
});
console.log("Done.");
