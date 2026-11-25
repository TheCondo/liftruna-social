// Links the Telegram bot to Connor's chat (D86). Run once, after Connor has
// saved TELEGRAM_BOT_TOKEN in .env.local and sent /start to the bot.
//   node marketing/autopost/telegram-setup.mjs
// Saves TELEGRAM_CHAT_ID (Connor's Telegram number, not a secret) in
// .env.local and sends a test message. Prints no keys.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { api } = await import("./lib/telegram.mjs");

const me = await api("getMe");
console.log(`Bot: @${me.username}`);

if (process.env.TELEGRAM_CHAT_ID) {
  console.log("TELEGRAM_CHAT_ID is already set; sending a test message.");
} else {
  const updates = await api("getUpdates", { timeout: 0 });
  const people = new Map();
  for (const u of updates) {
    const m = u.message;
    if (m?.chat?.type === "private" && m.from && !m.from.is_bot) people.set(m.from.id, m.from.first_name);
  }
  if (people.size !== 1) {
    console.log(
      people.size === 0
        ? "No one has messaged the bot yet. Open the bot in Telegram, tap Start, then run this again."
        : `${people.size} different people have messaged the bot; expected only Connor. Not linking.`,
    );
    process.exit(1);
  }
  const [[id, name]] = [...people];
  const env = readFileSync(".env.local", "utf8");
  appendFileSync(".env.local", `${env.endsWith("\n") ? "" : "\n"}TELEGRAM_CHAT_ID=${id}\n`);
  process.env.TELEGRAM_CHAT_ID = String(id);
  console.log(`Linked to ${name}'s chat.`);
}

// Messages sent before linking (Start, "hi") are not trend tips: skip them.
const pending = await api("getUpdates", { timeout: 0 });
if (pending.length) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    new URL("./data/telegram-state.json", import.meta.url),
    `${JSON.stringify({ offset: pending.at(-1).update_id + 1, editing: null }, null, 1)}\n`,
  );
}

const { say } = await import("./lib/telegram.mjs");
await say("LiftRuna posts bot is connected ✅ Drafts will arrive here with Approve, Reject and Change caption buttons. Send me any trend or link and I'll build posts on it.");
console.log("Test message sent.");
