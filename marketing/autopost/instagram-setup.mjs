// Connects Instagram to the LiftRuna posts Worker (D86). Run once, after
// Connor has saved IG_TOKEN (from the Meta app's "Generate token") in
// .env.local:
//   node marketing/autopost/instagram-setup.mjs
// New Meta apps use "Unified login" (graph.facebook.com, a system-user key);
// the account number comes from /me/assigned_instagram_accounts. Checks the
// key, finds the LiftRuna account and gives both to the Worker. Prints the
// account name only, never the key.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const config = "marketing/autopost/worker/wrangler.toml";
const toml = readFileSync(config, "utf8");
const version = toml.match(/IG_API_VERSION = "(.*)"/)?.[1] || "v27.0";
const host = toml.match(/IG_GRAPH_HOST = "(.*)"/)?.[1] || "graph.facebook.com";
const token = process.env.IG_TOKEN?.trim();
if (!token) throw new Error("IG_TOKEN missing from .env.local");

const res = await fetch(`https://${host}/${version}/me/assigned_instagram_accounts?fields=id,username`, { headers: { Authorization: `Bearer ${token}` } });
const out = await res.json();
if (!res.ok || out.error) throw new Error(`Meta did not accept the key: ${out.error?.message ?? res.status}`);
const accounts = out.data ?? [];
console.log(`Instagram accounts this key can post to: ${accounts.map((a) => `@${a.username}`).join(", ") || "none"}`);
const account = accounts.find((a) => /liftruna/i.test(a.username)) ?? (accounts.length === 1 ? accounts[0] : null);
if (!account) throw new Error("Couldn't pick the LiftRuna account: it should be the only one, or have LiftRuna in its name.");
console.log(`Using @${account.username}`);

if (process.env.IG_USER_ID !== String(account.id)) {
  const env = readFileSync(".env.local", "utf8");
  appendFileSync(".env.local", `${env.endsWith("\n") ? "" : "\n"}IG_USER_ID=${account.id}\n`);
}

function wrangler(args, input) {
  const run = spawnSync("npx", ["--yes", "wrangler@4", ...args, "--config", config], { input, encoding: "utf8", shell: true });
  if (run.status !== 0) throw new Error(`wrangler ${args.slice(0, 2).join(" ")} failed:\n${run.stderr || run.stdout}`);
}
wrangler(["secret", "put", "IG_TOKEN"], token);
wrangler(["secret", "put", "IG_USER_ID"], String(account.id));
wrangler(["deploy"]);
console.log("The Worker can now post to Instagram.");
