// Telegram approval for social post drafts (D86).
// A free bot sends Connor each draft with Approve, Reject and Change caption
// buttons. No server: whenever a job runs it asks Telegram what was tapped
// since last time (Telegram keeps it for 24 hours), then changes each
// draft's buttons to show the result. The bot only obeys Connor's own chat
// (TELEGRAM_CHAT_ID); everyone else is ignored.
// Keys come from .env.local on a computer, or GitHub secrets later.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { check } from "./safety.mjs";

const state = new URL("../data/telegram-state.json", import.meta.url);
const historyFile = new URL("../data/history.json", import.meta.url);
const inboxFile = new URL("../data/inbox.json", import.meta.url);
const readJson = (url, fallback) => (existsSync(url) ? JSON.parse(readFileSync(url, "utf8")) : fallback);
const writeJson = (url, value) => writeFileSync(url, `${JSON.stringify(value, null, 1)}\n`);

export function settings() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set (see marketing/autopost/README.md)");
  return { token, chat };
}

export async function api(method, body) {
  const { token } = settings();
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    ...(body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
  });
  const json = await res.json();
  // Never print the token: errors carry only Telegram's description.
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result;
}

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
  editing: "✏️ Send the new caption as your next message",
  draft: "✏️ Caption changed: tap Approve when you're happy",
};

// Sends one draft: the slides (as an album when there are several), then
// the caption with the buttons. Returns the message to update later.
export async function sendDraft(post, files, { number, of, video, day } = {}) {
  const { chat } = settings();
  const form = new FormData();
  form.append("chat_id", chat);
  if (video) {
    form.append("video", new Blob([readFileSync(video)], { type: "video/mp4" }), basename(video));
    form.append("supports_streaming", "true");
    await api("sendVideo", form);
  } else if (files.length === 1) {
    form.append("photo", new Blob([readFileSync(files[0])]), basename(files[0]));
    await api("sendPhoto", form);
  } else {
    form.append("media", JSON.stringify(files.slice(0, 10).map((f, i) => ({ type: "photo", media: `attach://p${i}` }))));
    files.slice(0, 10).forEach((f, i) => form.append(`p${i}`, new Blob([readFileSync(f)]), basename(f)));
    await api("sendMediaGroup", form);
  }
  const head = [
    `${day ? `${day} · ` : ""}Draft ${number ?? ""}${of ? ` of ${of}` : ""} · ${{ video: "🎬 video (Reel)", carousel: "🖼️ swipe carousel", single: "🖼️ single picture" }[post.format] ?? post.layout} · for ${post.audience}`,
    `Idea from: ${post.source}`,
  ].join("\n");
  const message = await api("sendMessage", { chat_id: chat, text: `${head}\n\n${post.caption}`.slice(0, 4000), reply_markup: buttons(post.id) });
  return message.message_id;
}

export const say = (text) => api("sendMessage", { chat_id: settings().chat, text });

// Replaces a draft's buttons with its result, so Connor can see where it stands.
async function showResult(post) {
  if (!post.telegramMessageId) return;
  const keyboard = post.status === "editing" || post.status === "draft" ? buttons(post.id) : { inline_keyboard: [[{ text: results[post.status], callback_data: "done" }]] };
  await api("editMessageReplyMarkup", { chat_id: settings().chat, message_id: post.telegramMessageId, reply_markup: keyboard }).catch(() => {});
}

// Reads taps and messages since last time and applies them:
// - Approve / Reject: the draft's status in data/history.json (the last tap
//   on a draft wins; repeated taps change nothing),
// - Change caption: the next message Connor sends becomes the caption
//   (it must pass the safety check),
// - any other message: saved to the trend inbox (data/inbox.json).
// Then one summary message, rather than one reply per tap.
export async function readReplies({ log = () => {} } = {}) {
  const { chat } = settings();
  const st = readJson(state, { offset: 0, editing: null });
  const history = readJson(historyFile, []);
  const inbox = readJson(inboxFile, []);
  const updates = await api("getUpdates", { offset: st.offset, timeout: 0, allowed_updates: ["message", "callback_query"] });
  const find = (id) => history.find((p) => p.id === id);
  const changed = new Map();
  const notes = [];

  for (const u of updates) {
    st.offset = u.update_id + 1;
    const from = String(u.callback_query?.from?.id ?? u.message?.from?.id ?? "");
    if (from !== String(chat)) {
      log("  ignored an update from someone else");
      continue;
    }
    if (u.callback_query) {
      await api("answerCallbackQuery", { callback_query_id: u.callback_query.id }).catch(() => {});
      const [action, id] = u.callback_query.data.split(":");
      const post = find(id);
      if (!post) continue;
      if (action === "a") {
        post.status = "approved";
        post.approvedAt = new Date().toISOString();
      } else if (action === "r") {
        post.status = "rejected";
      } else if (action === "e") {
        post.status = "editing";
        st.editing = id;
      }
      changed.set(id, post);
      log(`  ${id}: ${action}`);
    } else if (u.message?.text) {
      const text = u.message.text.trim();
      if (text.startsWith("/")) continue;
      const post = st.editing ? find(st.editing) : null;
      if (post) {
        const problems = check(text);
        if (problems.length) {
          notes.push(`Caption for ${post.id} not changed: ${problems.join(", ")}. Send another, or tap Approve to keep the old one.`);
        } else {
          post.caption = text;
          post.captionEditedAt = new Date().toISOString();
          post.status = "draft";
          notes.push(`New caption for ${post.id}:\n\n${text}`);
          changed.set(post.id, post);
          st.editing = null;
        }
      } else {
        inbox.push({ at: new Date(u.message.date * 1000).toISOString(), text: text.slice(0, 300) });
        notes.push(`Saved to the trend inbox: "${text.slice(0, 80)}". The next drafts will build on it.`);
        log(`  trend inbox: ${text.slice(0, 60)}`);
      }
    }
  }

  for (const post of changed.values()) await showResult(post);
  const summary = [...changed.values()].map((p) => `${p.id}: ${results[p.status]}`);
  const parts = [...(summary.length ? [`Read your taps:\n${summary.join("\n")}`] : []), ...notes];
  if (parts.length) await say(parts.join("\n\n"));
  writeJson(state, st);
  writeJson(historyFile, history);
  writeJson(inboxFile, inbox);
  return { history, inbox };
}
