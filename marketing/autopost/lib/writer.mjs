// Picks and writes the day's posts (D86).
// Template writing for now: ideas and hooks from data/ideas.json, filled with
// the day's topic or event. Free AI writing (Gemini) plugs in here later.
import { readFileSync } from "node:fs";
import { check } from "./safety.mjs";

const bank = JSON.parse(readFileSync(new URL("../data/ideas.json", import.meta.url), "utf8"));

function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const shuffle = (r, xs) => xs.map((x) => [r(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// How alike two texts are, 0 to 1 (shared word pairs).
const pairs = (s) => {
  const w = s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return new Set(w.slice(1).map((x, i) => `${w[i]} ${x}`).concat(w.length === 1 ? w : []));
};
export function similarity(a, b) {
  const A = pairs(a), B = pairs(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  return both / Math.min(A.size, B.size);
}

function fill(text, ctx) {
  return text
    .replaceAll("{topic}", ctx.topic?.name ?? "")
    .replaceAll("{Topic}", cap(ctx.topic?.name ?? ""))
    .replaceAll("{angle}", ctx.topic?.angle ?? ctx.event?.angle ?? "")
    .replaceAll("{Angle}", cap(ctx.topic?.angle ?? ctx.event?.angle ?? ""))
    .replaceAll("{event}", ctx.event?.name ?? "")
    .replaceAll("{Event}", cap(ctx.event?.name ?? ""))
    .replaceAll("{days}", String(ctx.event?.days ?? ""))
    .replaceAll("{Days}", String(ctx.event?.days ?? ""));
}

function hashtags(r, audience, topic) {
  const t = bank.hashtags;
  const own = topic && !topic.inbox ? [`#${topic.name.replace(/[^a-z0-9]/gi, "").toLowerCase()}`] : [];
  return [...t.always, ...own, ...shuffle(r, t[audience === "trainers" ? "trainers" : "everyone"]).slice(0, 5)];
}

// One post from one idea, or null if it fails a check.
function write(idea, ctx, r, id) {
  const variant = Math.floor(r() * idea.hooks.length);
  const hook = fill(idea.hooks[variant], ctx);
  const sub = idea.sub ? fill(idea.sub[variant % idea.sub.length], ctx) : "";
  const audience = idea.audience;
  const cta = pick(r, bank.cta[audience === "trainers" ? "trainers" : "everyone"]);
  const eyebrow = audience === "trainers" ? "For personal trainers" : ctx.topic ? cap(ctx.topic.name) : ctx.event ? cap(ctx.event.name) : "Training together";
  const points = idea.points ?? [];
  const options = idea.options ? idea.options[variant % idea.options.length] : null;
  const body = [hook, sub, ...points.map(([b, s]) => `${b}: ${s}`), options ? `A) ${options[0]}  B) ${options[1]}\nComment A or B 👇` : ""]
    .filter(Boolean)
    .join("\n\n");
  const caption = `${body}\n\n${cta}\n\n${hashtags(r, audience, ctx.topic).join(" ")}`;
  const post = {
    id,
    idea: idea.id,
    layout: idea.layout,
    audience,
    hook,
    sub,
    points,
    options,
    eyebrow,
    cta,
    ctaShort: "DM us BETA",
    screen: idea.screen ? bank.screens[idea.screen].file : null,
    stepScreens: (idea.stepScreens ?? []).map((k) => bank.screens[k].file),
    days: ctx.event?.days,
    eventName: ctx.event?.name,
    source: ctx.topic ? `topic: ${ctx.topic.name}${ctx.topic.search ? ` (Google Trends: ${ctx.topic.search})` : ""}${ctx.topic.inbox ? " (trend inbox)" : ""}` : ctx.event ? `calendar: ${ctx.event.name} in ${ctx.event.days} days` : "evergreen",
    caption,
  };
  const problems = check(`${caption}\n${hook}\n${sub}`);
  return problems.length ? { rejected: problems, post } : { post };
}

// The day's posts. history: earlier posts (newest last). Rules:
// - never a hook or text too like an earlier post (similarity >= 0.5),
// - no idea used in the last 10 posts, no layout used in the previous 2,
// - no two posts of the same layout or audience-and-topic on one day,
// - at least one post for trainers each day; topical posts first.
export function plan({ date, count = 3, trends, history = [], log = () => {}, firstNumber = 1 }) {
  const r = rng(`plan-${date}`);
  const topics = [...trends.rising, ...shuffle(r, trends.steady)];
  const events = trends.events;
  const chosen = [];
  const recent = () => [...history, ...chosen];
  const usable = (idea) => {
    const last = recent();
    if (last.slice(-10).some((p) => p.idea === idea.id)) return false;
    if (last.slice(-2).some((p) => p.layout === idea.layout)) return false;
    if (chosen.some((p) => p.layout === idea.layout)) return false;
    return true;
  };
  const tooLike = (post) =>
    recent().some((p) => similarity(p.hook, post.hook) >= 0.5 || similarity(`${p.hook} ${p.sub}`, `${post.hook} ${post.sub}`) >= 0.5);

  // Candidates: topical ideas with each topic or event, then evergreen ideas.
  const candidates = [];
  for (const idea of shuffle(r, bank.ideas)) {
    if (idea.needs === "event") for (const event of events) candidates.push({ idea, ctx: { event }, rank: 0 });
    else if (idea.needs === "topic") topics.forEach((topic) => candidates.push({ idea, ctx: { topic }, rank: topic.rising ? 0 : 1 + r() }));
    else candidates.push({ idea, ctx: {}, rank: 1 + r() });
  }
  candidates.sort((a, b) => a.rank - b.rank);

  const usedTopics = new Set();
  for (const pass of ["trainers", "any"]) {
    for (const c of candidates) {
      if (chosen.length >= count) break;
      if (pass === "trainers" && (c.idea.audience !== "trainers" || chosen.some((p) => p.audience === "trainers"))) continue;
      if (!usable(c.idea)) continue;
      const key = c.ctx.topic?.id ?? c.ctx.event?.id;
      if (key && usedTopics.has(key)) continue;
      const out = write(c.idea, c.ctx, rng(`${date}-${chosen.length + firstNumber - 1}-${c.idea.id}-${key ?? ""}`), `${date}-${chosen.length + firstNumber}`);
      if (out.rejected) {
        log(`  rejected ${c.idea.id}: ${out.rejected.join(", ")}`);
        continue;
      }
      if (tooLike(out.post)) {
        log(`  too like an earlier post: ${out.post.hook}`);
        continue;
      }
      chosen.push(out.post);
      if (key) usedTopics.add(key);
    }
  }
  return chosen;
}
