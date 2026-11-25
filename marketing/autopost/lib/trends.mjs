// What's topical today (D86), from free sources only:
// - the UK fitness calendar (data/calendar.json),
// - Wikipedia page views for the watched fitness topics (data/topics.json),
//   official free API: https://wikimedia.org/api/rest_v1/,
// - the Google Trends "Trending now" UK feed (public RSS), kept only when it
//   matches a watched topic.
// Nothing here scrapes TikTok, Instagram or Facebook (their terms forbid it).
import { readFileSync } from "node:fs";
import { blockedTopic } from "./safety.mjs";

const here = new URL("../data/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, here), "utf8"));

// A generic client name only; nothing about the project or its owner.
const headers = { "User-Agent": "trend-scanner/0.1 (fitness topics; low volume)" };
const day = 86_400_000;
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll("-", "");

// Upcoming calendar moments within their lead time.
export function upcomingEvents(today = new Date()) {
  const { events } = load("calendar.json");
  const out = [];
  for (const e of events) {
    for (const year of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
      const date = new Date(Date.UTC(year, e.month - 1, e.day));
      const days = Math.round((date - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / day);
      if (days >= 0 && days <= e.lead) out.push({ kind: "event", id: e.id, name: e.name, angle: e.angle, days });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

// Daily views for one article over the last `span` days (ending yesterday).
async function views(article, end, span) {
  const start = new Date(end - (span - 1) * day);
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/${encodeURIComponent(article)}/daily/${ymd(start)}00/${ymd(end)}00`;
  // Wikimedia limits anonymous clients: on "too many requests", wait and retry.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after")) || 5 * 2 ** attempt;
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) return null;
    const { items } = await res.json();
    return items.map((i) => i.views);
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Topics whose last 7 days are well above the 28 days before.
export async function risingTopics({ today = new Date(), ratio = 1.25, minDaily = 150, log = () => {} } = {}) {
  const { topics } = load("topics.json");
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - day);
  const out = [];
  for (const t of topics) {
    if (t !== topics[0]) await sleep(1100); // about one request a second, well inside Wikimedia's limits
    const series = await views(t.article, end, 35);
    if (!series || series.length < 30) {
      log(`  no data for ${t.article}`);
      continue;
    }
    const recent = series.slice(-7);
    const before = series.slice(0, -7);
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const r = avg(recent) / Math.max(avg(before), 1);
    if (avg(recent) >= minDaily) out.push({ kind: "topic", id: t.article, name: t.name, angle: t.angle, score: r, rising: r >= ratio });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Google Trends UK headlines that mention a watched topic.
export async function trendingSearches({ log = () => {} } = {}) {
  const { topics } = load("topics.json");
  try {
    const res = await fetch("https://trends.google.com/trending/rss?geo=GB", { headers });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const xml = await res.text();
    const titles = [...xml.matchAll(/<item>[\s\S]*?<title>([^<]+)<\/title>/g)].map((m) => m[1].trim());
    const hits = [];
    for (const title of titles) {
      if (blockedTopic(title)) continue;
      const t = topics.find((x) => title.toLowerCase().includes(x.name.toLowerCase()));
      if (t) hits.push({ kind: "topic", id: t.article, name: t.name, angle: t.angle, score: 2, rising: true, search: title });
    }
    return { titles, hits };
  } catch (error) {
    log(`  Google Trends feed unavailable (${error.message})`);
    return { titles: [], hits: [] };
  }
}

// Everything for today, plus things Connor sent to the trend inbox.
export async function scan({ today = new Date(), inbox = [], log = () => {} } = {}) {
  const events = upcomingEvents(today);
  log(`Calendar: ${events.length} upcoming`);
  const topics = await risingTopics({ today, log });
  log(`Wikipedia: ${topics.filter((t) => t.rising).length} rising of ${topics.length} with enough views`);
  const searches = await trendingSearches({ log });
  log(`Google Trends UK: ${searches.titles.length} headlines, ${searches.hits.length} fitness matches`);
  const fromInbox = inbox
    .filter((i) => !blockedTopic(i.text))
    .map((i) => ({ kind: "topic", id: `inbox-${i.at}`, name: i.text, angle: "train for it with a coach and log every session", score: 3, rising: true, inbox: true }));
  const rising = [...fromInbox, ...searches.hits, ...topics.filter((t) => t.rising)];
  const seen = new Set();
  const unique = rising.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
  // Steady popular topics fill in on quiet days.
  const steady = topics.filter((t) => !t.rising).slice(0, 10);
  return { events, rising: unique, steady, headlines: searches.titles };
}
