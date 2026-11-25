// Makes the day's draft posts (D86): scans what's topical, writes 3 posts,
// checks them, and draws the slides.
//
//   node marketing/autopost/make-drafts.mjs                 today's 3 drafts, saved to history
//   node marketing/autopost/make-drafts.mjs --sample 3      3 days of samples, history untouched
//   node marketing/autopost/make-drafts.mjs --scan file.json  reuse a saved scan (no network)
//   add --send to send the drafts to Connor in Telegram
//
// With the Worker set up (WORKER_URL and DRAFTS_SECRET), --send also hands
// each draft and its slides to the Worker, which answers Connor's taps and
// posts approved drafts; history and the trend inbox then come from the
// Worker. Without it, taps are read from Telegram directly (testing only).
// Drafts go to marketing/autopost/drafts/<date>/ (not in git).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { draw, multiSlide } from "./lib/layouts.mjs";
import { render } from "./lib/render.mjs";
import { scan, upcomingEvents } from "./lib/trends.mjs";
import { makeReel } from "./lib/reel.mjs";
import { plan, similarity } from "./lib/writer.mjs";
import { aiEnabled, rewrite } from "./lib/ai.mjs";

// A mix every day: one video (Reel), one swipe carousel, one single picture,
// in a different order each day. Layouts with several slides are never
// "single".
function chooseFormats(posts, seed) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const order = [["video", "carousel", "single"], ["carousel", "single", "video"], ["single", "video", "carousel"]][h % 3];
  const formats = posts.map((_, i) => order[i % 3]);
  posts.forEach((p, i) => {
    if (formats[i] !== "single" || !multiSlide(p.layout)) return;
    const j = posts.findIndex((q, k) => k !== i && formats[k] !== "single" && !multiSlide(q.layout));
    if (j >= 0) [formats[i], formats[j]] = [formats[j], formats[i]];
    else formats[i] = "carousel";
  });
  return formats;
}

const here = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const send = args.includes("--send");
const sampleDays = Number(opt("--sample") ?? 0);
const scanFile = opt("--scan");
const count = Number(opt("--count") ?? 3);

const historyPath = join(here, "data", "history.json");
const inboxPath = join(here, "data", "inbox.json");
const log = (s) => console.log(s);

const worker = send && process.env.WORKER_URL && process.env.DRAFTS_SECRET ? process.env.WORKER_URL.replace(/\/$/, "") : null;
async function callWorker(method, path, body, type = "application/json") {
  const res = await fetch(`${worker}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.DRAFTS_SECRET}`, ...(body ? { "Content-Type": type } : {}) },
    body: body && type === "application/json" ? JSON.stringify(body) : body,
  });
  if (!res.ok) throw new Error(`Worker ${method} ${path}: ${res.status}`);
  return res.json();
}

const telegram = send ? await import("./lib/telegram.mjs") : null;
let history;
let inboxAll;
if (worker) {
  ({ drafts: history, inbox: inboxAll } = await callWorker("GET", "/state"));
  log(`Worker: ${history.length} earlier drafts, ${inboxAll.filter((i) => !i.used).length} new trend tips`);
} else {
  // Testing without the Worker: read taps straight from Telegram.
  if (telegram) await telegram.readReplies({ log });
  history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : [];
  inboxAll = existsSync(inboxPath) ? JSON.parse(readFileSync(inboxPath, "utf8")) : [];
}
const inbox = inboxAll.filter((i) => !i.used);

// --week: the whole coming week at once (Connor, 25 Nov 2026): 4 drafts for
// each day from next Monday, so he can approve the best 3 a day in one sitting.
const week = args.includes("--week");
const now = new Date();
const nextMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ((8 - now.getUTCDay()) % 7 || 7)));
const start = week ? nextMonday : now;
const today = start.toISOString().slice(0, 10);
// --extra N --format video|carousel|single: N more drafts today (testing).
const extra = Number(opt("--extra") ?? 0);
const onlyFormat = opt("--format");
if (!sampleDays && !extra && history.some((p) => p.date === today)) {
  log(`Drafts for ${today}${week ? " (the coming week)" : ""} were already made; nothing to do.`);
  process.exit(0);
}
const perDay = week ? Number(opt("--count") ?? 4) : count;

// A saved scan reuses its topics; calendar events are always read fresh.
const trends = scanFile ? { ...JSON.parse(readFileSync(scanFile, "utf8")), events: upcomingEvents() } : await scan({ log, inbox });
writeFileSync(join(here, "drafts-last-scan.json"), JSON.stringify(trends, null, 1));
log(`Writing: ${aiEnabled() ? `Gemini (${process.env.GEMINI_MODEL || "gemini-3.5-flash-lite"}), checked, with templates as fallback` : "templates (no GEMINI_API_KEY)"}`);

const days = sampleDays || (week ? 7 : 1);
const working = [...history];
if (telegram && week && !sampleDays) {
  const first = start.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  await telegram.say(
    `📋 Drafts for the week from ${first}: ${7 * perDay} coming up (${perDay} a day).\n` +
      "Approve your favourite 3 for each day (about 21). Instagram and Facebook then post 3 a day at 08:00, 12:30 and 18:30, " +
      "and the TikTok week plan arrives at 21:00 with the ones you approved. Anything you approve after 21:00 goes in next week's TikTok plan.",
  );
}
for (let d = 0; d < days; d++) {
  const date = new Date(start.getTime() + d * 86_400_000).toISOString().slice(0, 10);
  const label = sampleDays ? `sample-${date}` : date;
  const firstNumber = working.filter((p) => p.date === date).length + 1;
  // Calendar moments as seen from that day (a week ahead, Black Friday must not show after it has passed).
  const dayTrends = { ...trends, events: upcomingEvents(new Date(`${date}T06:00:00Z`)) };
  let posts = plan({ date: label, count: extra || perDay, trends: dayTrends, history: working, log, firstNumber: sampleDays ? 1 : firstNumber });
  // Fresh wording from Gemini, when its key is set (templates otherwise).
  const context = [...dayTrends.events.map((e) => `${e.name} in ${e.days} days`), ...trends.rising.slice(0, 5).map((t) => `${t.name} is getting more attention${t.inbox ? " (from Connor)" : ""}`)].join("; ");
  posts = await rewrite(posts, { recentHooks: working.map((p) => p.hook), context, similarity, log });
  const dir = join(here, "drafts", label);
  mkdirSync(dir, { recursive: true });
  const formats = onlyFormat ? posts.map(() => onlyFormat) : chooseFormats(posts, label);
  for (const [k, post] of posts.entries()) {
    const format = formats[k];
    const postDir = join(dir, `${post.id.split("-").pop()}-${post.idea}`);
    mkdirSync(postDir, { recursive: true });
    // --plan-only: choose and write the posts without drawing them (quick checks).
    const planOnly = args.includes("--plan-only");
    const files = planOnly ? [] : await render(draw(post, format), postDir);
    const reel = format === "video" && !planOnly ? await makeReel(post, postDir) : null;
    const video = reel?.file ?? null;
    writeFileSync(join(postDir, "caption.txt"), post.caption);
    writeFileSync(join(postDir, "post.json"), JSON.stringify({ ...post, format, files, video }, null, 1));
    log(`${label}  ${format.padEnd(8)} ${post.layout.padEnd(9)} ${post.audience.padEnd(8)} ${post.hook}  [${post.source}]  ${files.length} slide(s)`);
    const entry = { id: post.id, date, key: post.key, idea: post.idea, layout: post.layout, format, audience: post.audience, hook: post.hook, sub: post.sub, source: post.source, caption: post.caption, slides: files.length, status: "draft" };
    working.push(entry);
    if (telegram && !sampleDays) {
      if (worker) {
        // Pictures and video first, so the Worker has them before Connor can approve.
        for (const [i, f] of files.entries()) await callWorker("PUT", `/drafts/${post.id}/img/${i + 1}`, readFileSync(f), "image/jpeg");
        if (video) await callWorker("PUT", `/drafts/${post.id}/video`, readFileSync(video), "video/mp4");
      }
      entry.telegramMessageId = await telegram.sendDraft({ ...post, format }, files, { number: k + 1, of: posts.length, video, day: week ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "" });
      if (worker) await callWorker("PUT", `/drafts/${post.id}`, entry);
    }
  }
  if (posts.length < (extra || perDay)) log(`${label}: only ${posts.length} of ${extra || perDay} posts passed the checks`);
}
if (!sampleDays) {
  writeFileSync(historyPath, `${JSON.stringify(working, null, 1)}\n`);
  // Trend tips are used once.
  if (!scanFile && inbox.length) {
    if (worker) await callWorker("POST", "/inbox/used");
    else writeFileSync(inboxPath, `${JSON.stringify(inboxAll.map((i) => ({ ...i, used: true })), null, 1)}\n`);
  }
}
