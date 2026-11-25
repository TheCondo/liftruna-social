# Automatic social posts (D86)

Makes LiftRuna's daily Instagram and TikTok drafts. The plan is in `docs/social-autopost-plan.md`. This folder is separate from the app: it doesn't change the website or either database.

## What's built (24 November 2026)

| Part | File | What it does |
|---|---|---|
| Trend scan | `lib/trends.mjs` | UK fitness calendar, Wikipedia page views for 40 fitness topics (rising = last week well above the 4 weeks before), Google Trends UK headlines that match a topic, and the trend inbox (later, from Telegram) |
| Post ideas | `data/ideas.json` | 16 ideas with several hooks each, filled with the day's topic or event. Only real LiftRuna features |
| Safety check | `lib/safety.mjs`, `data/safety.json` | Rejects weight-loss numbers, body and diet claims, medical claims, sellers' words and anything aimed at under-18s; skips blocked trending topics (posts don't have to say 18+: Connor, 24 Nov 2026) |
| Repeat check | `lib/writer.mjs` | No hook or text too like any earlier post, no idea reused within 10 posts, no layout twice in a row or twice in a day, at least one post for trainers every day |
| Designs | `lib/layouts.mjs` | 7 layouts (hook, countdown, spotlight, question, tip, steps carousel, list carousel), with colours that vary, around real app screenshots of demo accounts |
| Images | `lib/render.mjs` | 1080 × 1350 PNGs, drawn by the browser the tests use |

## Run it

```
node marketing/autopost/make-drafts.mjs                  # today's 3 drafts (saved to data/history.json)
node marketing/autopost/make-drafts.mjs --sample 4       # 4 days of samples, history untouched
node marketing/autopost/make-drafts.mjs --scan file.json # reuse a saved scan instead of going online
```

Drafts land in `marketing/autopost/drafts/<date>/` (not in git): one folder per post with its slides, `caption.txt` and `post.json`. The scan takes about a minute, because Wikipedia allows only slow requests.

## Telegram approval (built and tested 24 November 2026)

- **The bot:** @LiftRuna_Posts_Bot. It only obeys Connor's chat. Its key (`TELEGRAM_BOT_TOKEN`) and Connor's chat number (`TELEGRAM_CHAT_ID`) are in the ignored `.env.local`, and will be GitHub secrets once it runs on GitHub.
- **Set up on a new computer:** add the token to `.env.local`, then run `node marketing/autopost/telegram-setup.mjs`.
- **Drafts:** `make-drafts.mjs --send` sends each draft with Approve, Reject and Change caption buttons.
- **Reading taps:** taps are read when a job runs (there is no server), then each draft's buttons change to show the result and one summary message is sent.
- **Change caption:** the next message Connor sends becomes the caption, and it must pass the safety check.
- **Trend inbox:** any other message Connor sends goes to the trend inbox (`data/inbox.json`), and the next scan uses it once.
- **State files:** `data/history.json` (every draft and its status) and `data/telegram-state.json` (where reading stopped).

## Cloudflare Worker (instant taps and posting)

- `worker/index.mjs` runs on Cloudflare's free plan (no card). It answers Telegram taps straight away, stores drafts, slides and the trend inbox, and posts approved drafts at 08:00, 12:30 and 18:30 UTC.
- **Set up once:** Connor runs `npx wrangler@4 login`, then `node marketing/autopost/worker-setup.mjs`. That creates the storage, deploys the Worker, sets its secrets from `.env.local` and points the bot at it.
- **After that:** `make-drafts.mjs --send` hands each draft to the Worker (`WORKER_URL`, `DRAFTS_SECRET`).
- **Local test:** `npx wrangler@4 dev --local` in `worker/`, with fake keys in `worker/.dev.vars`, which is not in git.

## Instagram (connected 25 November 2026)

- Meta app **LiftRuna Posts** (Business, development mode) in the free business portfolio **LiftRuna**, using **Unified login** (graph.facebook.com, API v27.0). Meta gives new apps only this route.
- @liftruna is in the portfolio and is an Instagram Tester on the app. The configuration has no ad account.
- The key (`IG_TOKEN`) is a system-user key. The Worker checks it daily and warns in Telegram if Meta stops accepting it.
- **New key:** run Generate token in the Meta app, save it into `.env.local` with the Read-Host command, then run `node marketing/autopost/instagram-setup.mjs`.
- **Pictures:** JPEG only (Meta's rule). The Worker shows them publicly only once a draft is approved.
- **First post:** https://www.instagram.com/p/DgKUgg4ibuL/ (25 Nov 2026).

## Not built yet



- **The daily draft job on GitHub:** until then, run `make-drafts.mjs --send` from a computer.
- **Free AI writing (Gemini):** needs a LiftRuna Google account and key. Until then, posts are written from the templates in `data/ideas.json`.
- **Video versions** for TikTok and Reels.
- **The daily schedule on GitHub:** from 1 December.

## Keeping it fresh

- Add hooks and ideas to `data/ideas.json`, topics to `data/topics.json`, and moments to `data/calendar.json`. Check dates that move each year, such as the London Marathon and the Great North Run.
- Retake the app screenshots after big releases (they live in `marketing/tiktok/source/`).
