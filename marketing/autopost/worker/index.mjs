// LiftRuna posts Worker (D86), on Cloudflare's free plan.
// - Answers Connor's Telegram taps the moment he makes them (Telegram webhook).
// - Keeps every draft and its status, the slide images and the trend inbox
//   in Workers KV.
// - At the posting times (cron), posts the oldest approved draft to
//   Instagram, once Instagram is connected.
// - The daily GitHub job sends drafts here with a shared secret.
// It obeys only Connor's Telegram chat. No member or app data is involved.
import rules from "../data/safety.json";
import { makeChecks } from "../lib/safety-core.mjs";

const { check } = makeChecks(rules);

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const notFound = () => new Response("Not found", { status: 404 });

// Constant-time comparison of secrets.
function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const authorised = (req, env) => same(req.headers.get("Authorization") ?? "", `Bearer ${env.DRAFTS_SECRET}`);

async function telegram(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!out.ok) throw new Error(`Telegram ${method}: ${out.description}`);
  return out.result;
}
const say = (env, text) => telegram(env, "sendMessage", { chat_id: env.TELEGRAM_CHAT_ID, text });

const buttons = (id) => ({
  inline_keyboard: [
    [
      { text: "✅ Approve", callback_data: `a:${id}` },
      { text: "❌ Reject", callback_data: `r:${id}` },
    ],
    [{ text: "✏️ Change caption", callback_data: `e:${id}` }],
  ],
});
const results = {
  approved: "✅ Approved: posts at the next posting time",
  rejected: "❌ Rejected",
  posted: "📣 Posted to Instagram",
};

const getDraft = (env, id) => env.POSTS.get(`draft:${id}`, "json");
const putDraft = (env, d) => env.POSTS.put(`draft:${d.id}`, JSON.stringify(d));

async function allDrafts(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.POSTS.list({ prefix: "draft:", cursor });
    for (const k of page.keys) {
      const d = await env.POSTS.get(k.name, "json");
      if (d) out.push(d);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

async function showResult(env, d) {
  if (!d.telegramMessageId) return;
  const keyboard = results[d.status] ? { inline_keyboard: [[{ text: results[d.status], callback_data: "done" }]] } : buttons(d.id);
  await telegram(env, "editMessageReplyMarkup", { chat_id: env.TELEGRAM_CHAT_ID, message_id: d.telegramMessageId, reply_markup: keyboard }).catch(() => {});
}

// One Telegram update: a tap or a message from Connor.
async function onTelegram(env, update) {
  const from = String(update.callback_query?.from?.id ?? update.message?.from?.id ?? "");
  if (from !== String(env.TELEGRAM_CHAT_ID)) return; // only Connor

  if (update.callback_query) {
    const q = update.callback_query;
    const [action, id] = (q.data ?? "").split(":");
    const d = id ? await getDraft(env, id) : null;
    if (!d || d.status === "posted") {
      await telegram(env, "answerCallbackQuery", { callback_query_id: q.id, text: d ? "Already posted." : "" }).catch(() => {});
      return;
    }
    let note = "";
    if (action === "a") {
      d.status = "approved";
      d.approvedAt = new Date().toISOString();
      note = "Approved ✅";
    } else if (action === "r") {
      d.status = "rejected";
      note = "Rejected ❌";
    } else if (action === "e") {
      await env.POSTS.put("editing", id);
      note = "Send the new caption as your next message.";
      await say(env, `✏️ Send the new caption for ${id} as your next message.`);
    }
    await telegram(env, "answerCallbackQuery", { callback_query_id: q.id, text: note }).catch(() => {});
    if (action !== "e") {
      await putDraft(env, d);
      await showResult(env, d);
    }
    return;
  }

  const text = update.message?.text?.trim();
  if (!text || text.startsWith("/")) return;
  const editing = await env.POSTS.get("editing");
  const d = editing ? await getDraft(env, editing) : null;
  if (d && d.status !== "posted") {
    const problems = check(text);
    if (problems.length) {
      await say(env, `Caption not changed: ${problems.join(", ")}. Send another, or tap Approve to keep the old one.`);
      return;
    }
    d.caption = text;
    d.captionEditedAt = new Date().toISOString();
    await putDraft(env, d);
    await env.POSTS.delete("editing");
    await say(env, `New caption saved for ${d.id}. Tap ✅ Approve on it when you're happy.`);
    return;
  }
  const inbox = (await env.POSTS.get("inbox", "json")) ?? [];
  inbox.push({ at: new Date().toISOString(), text: text.slice(0, 300) });
  await env.POSTS.put("inbox", JSON.stringify(inbox.slice(-100)));
  await say(env, `Saved to the trend inbox: "${text.slice(0, 80)}". Tomorrow's drafts will build on it.`);
}

// Instagram (official "Instagram API with Instagram Login"). Images are
// fetched by Instagram from this Worker, and only once a draft is approved.
// The key: the renewed one in storage if there is one, else the first one.
const igToken = async (env) => (await env.POSTS.get("ig_token")) ?? env.IG_TOKEN;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function instagram(env, path, params, method = "POST") {
  const version = env.IG_API_VERSION ? `${env.IG_API_VERSION}/` : "";
  const query = method === "GET" ? `?${new URLSearchParams(params)}` : "";
  // New Meta apps use "Unified login": graph.facebook.com (IG_GRAPH_HOST).
  const res = await fetch(`https://${env.IG_GRAPH_HOST || "graph.facebook.com"}/${version}${path}${query}`, {
    method,
    headers: { Authorization: `Bearer ${await igToken(env)}` },
    ...(method === "POST" ? { body: new URLSearchParams(params) } : {}),
  });
  const out = await res.json();
  if (!res.ok || out.error) throw new Error(`Instagram ${path}: ${out.error?.message ?? res.status}`);
  return out;
}

// Instagram prepares each picture or video before it can be published.
// Videos take longer: up to about 4 minutes.
async function ready(env, container, video = false) {
  for (let i = 0; i < (video ? 48 : 10); i++) {
    const { status_code: status } = await instagram(env, container, { fields: "status_code" }, "GET");
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`Instagram could not prepare the ${video ? "video" : "picture"} (${status})`);
    await sleep(video ? 5000 : 3000);
  }
  throw new Error(`Instagram took too long to prepare the ${video ? "video" : "picture"}`);
}

async function publish(env, d, origin) {
  const url = (n) => `${origin}/img/${d.id}/${n}.jpg`;
  const user = env.IG_USER_ID;
  let creation;
  if (d.format === "video") {
    // A Reel, also shown in the main feed.
    creation = await instagram(env, `${user}/media`, { media_type: "REELS", video_url: `${origin}/img/${d.id}/video.mp4`, caption: d.caption, share_to_feed: "true" });
    await ready(env, creation.id, true);
    return (await instagram(env, `${user}/media_publish`, { creation_id: creation.id })).id;
  }
  if (d.slides === 1) {
    creation = await instagram(env, `${user}/media`, { image_url: url(1), caption: d.caption });
  } else {
    const children = [];
    for (let n = 1; n <= Math.min(d.slides, 20); n++) {
      const child = await instagram(env, `${user}/media`, { image_url: url(n), is_carousel_item: "true" });
      await ready(env, child.id);
      children.push(child.id);
    }
    creation = await instagram(env, `${user}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: d.caption });
  }
  await ready(env, creation.id);
  const done = await instagram(env, `${user}/media_publish`, { creation_id: creation.id });
  return done.id;
}

// Keeping the key working, checked once a day at the first posting time.
// - Unified login (graph.facebook.com): a system-user key, which Meta says
//   by default does not expire. It is checked daily; if Meta stops
//   accepting it, Connor is told in Telegram before a post is missed.
// - Instagram login (graph.instagram.com, older apps): keys last 60 days and
//   are renewed weekly, the renewed key kept in storage, never shown.
async function renewKey(env) {
  if (!(await igToken(env))) return;
  if ((env.IG_GRAPH_HOST || "graph.facebook.com") === "graph.facebook.com") {
    const today = new Date().toISOString().slice(0, 10);
    if ((await env.POSTS.get("ig_token_checked_on")) === today) return;
    await env.POSTS.put("ig_token_checked_on", today);
    try {
      await instagram(env, `${env.IG_USER_ID}`, { fields: "username" }, "GET");
    } catch (error) {
      await say(env, `⚠️ Meta isn't accepting the Instagram key: ${String(error.message).slice(0, 200)}. Posts can't go out until a new key is made in the Meta app (Generate token) and saved again.`);
    }
    return;
  }
  const last = await env.POSTS.get("ig_token_renewed_at");
  if (!last) {
    await env.POSTS.put("ig_token_renewed_at", new Date().toISOString());
    return;
  }
  if (Date.now() - Date.parse(last) < 7 * 86_400_000) return;
  try {
    const params = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: await igToken(env) });
    const res = await fetch(`https://graph.instagram.com/refresh_access_token?${params}`);
    const out = await res.json();
    if (!out.access_token) throw new Error(out.error?.message ?? `status ${res.status}`);
    await env.POSTS.put("ig_token", out.access_token);
    await env.POSTS.put("ig_token_renewed_at", new Date().toISOString());
  } catch (error) {
    await say(env, `⚠️ Couldn't renew the Instagram key: ${String(error.message).slice(0, 200)}. It will try again tomorrow; if it keeps failing, the key needs making again in the Meta app.`);
  }
}

// At each posting time: the oldest approved draft goes out.
async function postNext(env) {
  const next = (await allDrafts(env)).find((d) => d.status === "approved");
  if (!next) return;
  if (!(await igToken(env)) || !env.IG_USER_ID || !env.PUBLIC_ORIGIN) {
    if (!next.toldNotConnected) {
      next.toldNotConnected = true;
      await putDraft(env, next);
      await say(env, `${next.id} is approved, but Instagram isn't connected yet, so it was not posted. It will go out once Instagram is connected.`);
    }
    return;
  }
  try {
    next.igMediaId = await publish(env, next, env.PUBLIC_ORIGIN);
    next.status = "posted";
    next.postedAt = new Date().toISOString();
    await putDraft(env, next);
    await showResult(env, next);
    await say(env, `📣 Posted to Instagram: "${next.hook}"`);
  } catch (error) {
    next.lastError = String(error.message).slice(0, 300);
    await putDraft(env, next);
    await say(env, `⚠️ Couldn't post ${next.id} to Instagram: ${next.lastError}. It stays approved and will be tried at the next posting time.`);
  }
}

const worker = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);

    // Telegram calls this for every tap and message (secret header checked).
    if (req.method === "POST" && url.pathname === "/telegram") {
      if (!same(req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", env.WEBHOOK_SECRET)) return notFound();
      try {
        await onTelegram(env, await req.json());
      } catch (error) {
        console.log(`telegram update failed: ${error.message}`);
      }
      return new Response("ok");
    }

    // Slide images: public only once a draft is approved or posted, so
    // Instagram can fetch them. Drafts are never public.
    if (req.method === "GET" && parts[0] === "img" && parts.length === 3) {
      const d = await getDraft(env, parts[1]);
      if (!d || !["approved", "posted"].includes(d.status)) return notFound();
      if (parts[2] === "video.mp4") {
        const vid = await env.POSTS.get(`video:${d.id}`, "arrayBuffer");
        return vid ? new Response(vid, { headers: { "Content-Type": "video/mp4", "Cache-Control": "public, max-age=3600" } }) : notFound();
      }
      // JPEG: the only picture format Instagram accepts.
      const n = parts[2].replace(/\.jpg$/, "");
      const img = await env.POSTS.get(`img:${d.id}:${n}`, "arrayBuffer");
      return img ? new Response(img, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } }) : notFound();
    }

    // Everything below is for the daily GitHub job only.
    if (!authorised(req, env)) return notFound();
    if (req.method === "PUT" && parts[0] === "drafts" && parts.length === 2) {
      const d = await req.json();
      if (d.id !== parts[1]) return json({ error: "id mismatch" }, 400);
      const existing = await getDraft(env, d.id);
      await putDraft(env, { ...d, status: existing?.status ?? "draft", createdAt: existing?.createdAt ?? new Date().toISOString() });
      return json({ ok: true });
    }
    if (req.method === "PUT" && parts[0] === "drafts" && parts[2] === "video" && parts.length === 3) {
      await env.POSTS.put(`video:${parts[1]}`, await req.arrayBuffer(), { expirationTtl: 60 * 60 * 24 * 30 });
      return json({ ok: true });
    }
    if (req.method === "PUT" && parts[0] === "drafts" && parts[2] === "img" && parts.length === 4) {
      await env.POSTS.put(`img:${parts[1]}:${Number(parts[3])}`, await req.arrayBuffer(), { expirationTtl: 60 * 60 * 24 * 30 });
      return json({ ok: true });
    }
    if (req.method === "GET" && url.pathname === "/state") {
      return json({ drafts: await allDrafts(env), inbox: (await env.POSTS.get("inbox", "json")) ?? [] });
    }
    if (req.method === "POST" && url.pathname === "/inbox/used") {
      const inbox = (await env.POSTS.get("inbox", "json")) ?? [];
      await env.POSTS.put("inbox", JSON.stringify(inbox.map((i) => ({ ...i, used: true }))));
      return json({ ok: true });
    }
    if (req.method === "POST" && url.pathname === "/post-now") {
      await postNext(env);
      return json({ ok: true });
    }
    return notFound();
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(renewKey(env).then(() => postNext(env)));
  },
};

export default worker;
