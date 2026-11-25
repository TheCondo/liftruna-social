// Fresh wording with Google's free Gemini allowance (D86, Connor 25 Nov 2026).
// The templates still choose each post's idea, layout, screens and format;
// Gemini rewrites the words (hook, sub-line, points, A/B options, caption
// body) so 28 drafts a week stay fresh and use that week's trends.
// Everything it writes must still pass: length limits, the safety check,
// the repeat check and Connor's approval. Anything that fails, or any error,
// keeps the template wording. No key (GEMINI_API_KEY) means templates only.
// Posts carry no personal data, so the free tier's data use is acceptable.
import { check } from "./safety.mjs";

const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const FEATURES = [
  "trainer workspaces with a week-at-a-glance home",
  "invite links for clients (one use, last 7 days)",
  "client list with private labels and colours",
  "plans/programmes that trainers assign and clients follow",
  "workout logging and personal bests",
  "bookings: clients request sessions, trainers confirm, reminders and phone notifications",
  "private messages between trainer and client",
  "a community feed: posts, photos, likes, comments, following",
  "public trainer pages (services, gyms, videos) and a UK trainer directory",
];

const prompt = (posts, ctx) => `You write social media posts for LiftRuna, a UK app for personal trainers and their clients (closed beta).
Voice: confident, warm, punchy, British English, no hype, no emojis in hooks, no hashtags (they are added separately).
Rewrite the words of each post below so it is fresh and scroll-stopping. Keep each post's purpose, audience and structure:
same number of points (each point: a short bold line and a short explanation) and options if present.
This week's topical context: ${ctx.context || "nothing special"}.
Hooks already used recently (do NOT reuse or closely echo): ${ctx.recentHooks.slice(-40).map((h) => JSON.stringify(h)).join(", ")}.
Only mention these real features: ${FEATURES.join("; ")}.
Never: weight-loss numbers or promises, diets, fasting, body-shaming, before/after, medical or health claims, guaranteed results,
supplements or steroids, anything aimed at under-18s (no school or exam themes), invented statistics, testimonials or user numbers.
Limits: hook at most 60 characters; sub at most 110; point title at most 32; point detail at most 55; option at most 22; body at most 300.
Return ONLY JSON: {"posts":[{"i":<index>,"hook":"","sub":"","points":[["",""]],"options":["",""],"body":""}]}.
"body" is the caption text before the call to action (2-4 short lines).
Posts:
${JSON.stringify(posts.map((p, i) => ({ i, audience: p.audience, layout: p.layout, idea: p.idea, about: p.source, hook: p.hook, sub: p.sub, points: p.points, options: p.options })))}`;

// Finds the model's text in either of Google's response shapes.
function textOf(out) {
  const found = [];
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (typeof v.text === "string") found.push(v.text);
    for (const x of Object.values(v)) walk(x);
  };
  walk(out);
  return found.join("\n");
}

async function ask(text) {
  const key = process.env.GEMINI_API_KEY;
  const headers = { "Content-Type": "application/json", "x-goog-api-key": key };
  const base = "https://generativelanguage.googleapis.com/v1beta";
  // generateContent first; the newer Interactions API as a fallback.
  let res = await fetch(`${base}/models/${MODEL()}:generateContent`, {
    method: "POST",
    headers,
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }], generationConfig: { responseMimeType: "application/json", temperature: 1 } }),
  });
  if (!res.ok) {
    res = await fetch(`${base}/interactions`, {
      method: "POST",
      headers: { ...headers, "Api-Revision": "2026-05-20" },
      body: JSON.stringify({ model: MODEL(), input: text, response_format: { type: "text", mime_type: "application/json" } }),
    });
  }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const raw = textOf(await res.json());
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  return JSON.parse(json);
}

const short = (s, n) => typeof s === "string" && s.trim().length > 0 && s.trim().length <= n;

export const aiEnabled = () => Boolean(process.env.GEMINI_API_KEY);

// Rewrites a day's posts in place where the new wording passes every check.
export async function rewrite(posts, { recentHooks, context, similarity, log = () => {} }) {
  if (!aiEnabled() || !posts.length) return posts;
  let answer;
  try {
    answer = await ask(prompt(posts, { recentHooks, context }));
  } catch (error) {
    log(`  AI writing unavailable (${error.message}); using templates`);
    return posts;
  }
  const seen = [...recentHooks];
  return posts.map((p, i) => {
    const a = (answer.posts ?? []).find((x) => x.i === i);
    if (!a) return p;
    const points = p.points?.length ? a.points : [];
    const ok =
      short(a.hook, 60) &&
      (!p.sub || short(a.sub, 110)) &&
      short(a.body, 320) &&
      (!p.points?.length || (Array.isArray(points) && points.length === p.points.length && points.every((x) => short(x?.[0], 32) && short(x?.[1], 55)))) &&
      (!p.options || (Array.isArray(a.options) && a.options.length === 2 && a.options.every((o) => short(o, 22))));
    if (!ok) {
      log(`  AI wording for ${p.id} broke a length rule; template kept`);
      return p;
    }
    const tags = p.caption.split("\n").filter((l) => l.trim().startsWith("#")).join(" ");
    const caption = `${a.body.trim()}\n\n${p.cta}\n\n${tags}`;
    const all = [a.hook, a.sub, ...points.flat(), ...(a.options ?? []), caption].join("\n");
    const problems = check(all);
    if (problems.length) {
      log(`  AI wording for ${p.id} failed the safety check (${problems.join(", ")}); template kept`);
      return p;
    }
    if (seen.some((h) => similarity(h, a.hook) >= 0.5)) {
      log(`  AI hook for ${p.id} too like an earlier one; template kept`);
      return p;
    }
    seen.push(a.hook);
    return { ...p, hook: a.hook.trim(), sub: p.sub ? a.sub.trim() : "", points: p.points?.length ? points : p.points, options: p.options ? a.options : p.options, caption, writtenBy: "ai" };
  });
}
