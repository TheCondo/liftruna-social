# LiftRuna social posts

The social post agent for [LiftRuna](https://liftruna.com), a UK fitness coaching platform. It is kept apart from the app, which lives in its own private repository.

- **Every morning (GitHub Actions, 06:30 UTC):** it checks what's topical in UK fitness, writes 3 different posts (one video, one swipe carousel, one single picture), checks them against safety rules and earlier posts, and sends them to the owner in Telegram.
- **In Telegram:** the owner taps Approve, Reject or Change caption. Nothing is posted without approval.
- **A Cloudflare Worker** (`marketing/autopost/worker/`) answers those taps instantly and posts approved drafts to Instagram at 08:00, 12:30 and 18:30 UTC.

How it works and how to run it: [`marketing/autopost/README.md`](marketing/autopost/README.md).

**No keys are in this repository.** They are GitHub secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `WORKER_URL`, `DRAFTS_SECRET`) and Cloudflare Worker secrets. On a computer they go in `.env.local`, which git ignores.

**Fonts:** Bricolage Grotesque and DM Sans, both under the SIL Open Font License 1.1 (https://openfontlicense.org).

**Screenshots:** the real LiftRuna app, using fictional demo accounts only.
