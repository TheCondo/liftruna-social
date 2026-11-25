// Connects the LiftRuna Facebook Page to the posts Worker (D86). Run once,
// after Connor has saved FB_SYSTEM_TOKEN (the business portfolio's system
// user key, set to never expire) in .env.local:
//   node marketing/autopost/facebook-setup.mjs
// Finds the Page the key can post to, checks it may create posts, and gives
// the key and the Page's number to the Worker. Prints the Page name only.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const config = "marketing/autopost/worker/wrangler.toml";
const token = process.env.FB_SYSTEM_TOKEN?.trim();
if (!token) throw new Error("FB_SYSTEM_TOKEN missing from .env.local");

const res = await fetch(`https://graph.facebook.com/v27.0/me/accounts?${new URLSearchParams({ fields: "id,name,tasks", access_token: token })}`);
const out = await res.json();
if (!res.ok || out.error) throw new Error(`Meta did not accept the key: ${out.error?.message ?? res.status}`);
const pages = out.data ?? [];
console.log(`Facebook Pages this key can reach: ${pages.map((p) => p.name).join(", ") || "none"}`);
const page = pages.find((p) => /liftruna/i.test(p.name)) ?? (pages.length === 1 ? pages[0] : null);
if (!page) throw new Error("Couldn't pick the LiftRuna Page: it should be the only one, or have LiftRuna in its name.");
if (!(page.tasks ?? []).includes("CREATE_CONTENT")) throw new Error(`The key can see "${page.name}" but may not post to it: give the system user full control of the Page.`);
console.log(`Using the Page "${page.name}"`);

if (process.env.FB_PAGE_ID !== String(page.id)) {
  const env = readFileSync(".env.local", "utf8");
  appendFileSync(".env.local", `${env.endsWith("\n") ? "" : "\n"}FB_PAGE_ID=${page.id}\n`);
}

function wrangler(args, input) {
  const run = spawnSync("npx", ["--yes", "wrangler@4", ...args, "--config", config], { input, encoding: "utf8", shell: true });
  if (run.status !== 0) throw new Error(`wrangler ${args.slice(0, 2).join(" ")} failed:\n${run.stderr || run.stdout}`);
}
wrangler(["secret", "put", "FB_SYSTEM_TOKEN"], token);
wrangler(["secret", "put", "FB_PAGE_ID"], String(page.id));
wrangler(["deploy"]);
console.log("The Worker can now post to the Facebook Page as well.");
