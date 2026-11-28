// Records real LiftRuna app footage for the social posts (Connor, 28 Nov 2026).
// The real app runs on this computer against the TEST database only, with
// fictional demo accounts (demo-*@fitconnect.test). Only features that work
// on the live beta are filmed: trainer home, invites and joining, bookings,
// the feed, plans and the public trainer page (no workout logging or other
// health tracking, which is closed on live).
//
//   node marketing/footage/record.mjs seed     # demo trainer, clients, posts
//   node marketing/footage/record.mjs record   # films the clips
//
// Needs the app running at http://localhost:3000 and FITCONNECT_ENV pointing
// at the app's .env.local (TEST URL, publishable key, test beta secret).
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = fileURLToPath(new URL(".", import.meta.url));
const BASE = process.env.APP_URL || "http://localhost:3000";
const mode = process.argv[2];

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const app = Object.fromEntries(
  readFileSync(process.env.FITCONNECT_ENV ?? "../FitConnect/.env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
if (!app.NEXT_PUBLIC_SUPABASE_URL?.includes("alsdskbyawshsijkukge")) throw new Error("Refusing: not the TEST database");
if (!process.env.DEMO_PASSWORD) {
  const pw = randomBytes(12).toString("base64url");
  appendFileSync(".env.local", `\nDEMO_PASSWORD=${pw}\n`);
  process.env.DEMO_PASSWORD = pw;
}
const PASSWORD = process.env.DEMO_PASSWORD;

const TRAINER = { name: "Jordan Reid", email: "demo-jordan@fitconnect.test", workspace: "Reid Strength", slug: "reid-strength" };
const CLIENTS = [
  { name: "Sam Carter", email: "demo-sam@fitconnect.test" },
  { name: "Priya Shah", email: "demo-priya@fitconnect.test" },
  { name: "Leo Bennett", email: "demo-leo@fitconnect.test" },
];

async function rpc(name, args) {
  const res = await fetch(`${app.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: app.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ issuer_secret: app.E2E_BETA_ISSUER_SECRET, ...args }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${name}: ${body}`);
  return body ? JSON.parse(body) : null;
}

// A phone-sized browser; the tap marker shows where a finger touches.
async function phone(browser) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => {
    addEventListener("pointerdown", (e) => {
      const dot = document.createElement("div");
      dot.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;background:rgba(167,139,250,.45);border:2px solid rgba(255,255,255,.8);z-index:2147483647;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out`;
      document.documentElement.appendChild(dot);
      requestAnimationFrame(() => { dot.style.transform = "scale(1.8)"; dot.style.opacity = "0"; });
      setTimeout(() => dot.remove(), 600);
    }, true);
  });
  return { context, page: await context.newPage() };
}

const pause = (page, ms = 900) => page.waitForTimeout(ms);
// A smooth finger-like scroll.
const scroll = async (page, y, ms = 1400) => {
  await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: "smooth" }), y);
  await pause(page, ms);
};
const type = (locator, text) => locator.pressSequentially(text, { delay: 55 });

async function logIn(page, email) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
}

async function exists(browser, email) {
  const { context, page } = await phone(browser);
  try {
    await logIn(page, email);
    return true;
  } catch {
    return false;
  } finally {
    await context.close();
  }
}

async function signUpForm(page, { name, email, trainer }) {
  if (trainer) await page.getByLabel("A personal trainer").check();
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("I confirm I am 18 or over").check();
  await page.getByLabel(/I accept the beta terms/).check();
  const code = page.getByLabel("Invitation code");
  if ((await code.count()) && !(await code.inputValue())) await code.fill(await rpc("e2e_issue_beta_code", { uses: 1, valid_seconds: 900 }));
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signup") && !u.pathname.startsWith("/invite"), { timeout: 30_000 });
}

async function invite(page) {
  await page.goto("/dashboard/clients");
  await page.getByRole("button", { name: "Create invite link" }).click();
  const box = page.getByRole("textbox", { name: "Invite link" });
  await box.waitFor();
  return box.inputValue();
}

async function seed() {
  const browser = await chromium.launch();
  try {
    // The trainer and their workspace.
    if (!(await exists(browser, TRAINER.email))) {
      const { context, page } = await phone(browser);
      await page.goto("/signup");
      await signUpForm(page, { ...TRAINER, trainer: true });
      await context.close();
      console.log("trainer created");
    }
    await rpc("e2e_approve_trainer", { trainer_email: TRAINER.email, allowance: 50 });
    {
      const { context, page } = await phone(browser);
      await logIn(page, TRAINER.email);
      await page.goto("/dashboard");
      const nameBox = page.getByLabel("Workspace name");
      if (await nameBox.count()) {
        await nameBox.fill(TRAINER.workspace);
        await page.getByLabel("Web address for your page").fill(TRAINER.slug);
        await page.getByLabel("Description").fill("Strength coaching in Leeds. Small groups and 1:1, built around your week.");
        await page.getByRole("button", { name: "Create workspace" }).click();
        await page.getByText("Your workspace", { exact: true }).waitFor();
        console.log("workspace created");
      }
      await context.close();
    }
    // Clients join through invite links.
    for (const c of CLIENTS) {
      if (await exists(browser, c.email)) {
        console.log(`${c.name} exists`);
        continue;
      }
      const t = await phone(browser);
      await logIn(t.page, TRAINER.email);
      const link = await invite(t.page);
      await t.context.close();
      const { context, page } = await phone(browser);
      await page.goto(link);
      await page.getByRole("button", { name: "Create an account to join" }).click();
      await signUpForm(page, c);
      await context.close();
      console.log(`${c.name} joined`);
    }
    // Some feed posts from clients.
    const posts = {
      "Sam Carter": "Leg day done. Squats felt strong today, thanks for the plan Jordan!",
      "Priya Shah": "First 5k in under 30 minutes. Couldn't have done it without this crew.",
      "Leo Bennett": "Early session before work. Coffee earned.",
    };
    for (const c of CLIENTS) {
      const { context, page } = await phone(browser);
      await logIn(page, c.email);
      await page.goto("/feed");
      if (!(await page.getByText(posts[c.name].slice(0, 20)).count())) {
        const composer = page.getByRole("region", { name: "New post" });
        await composer.getByText("What did you train today?").click();
        await composer.getByLabel("Share an update").fill(posts[c.name]);
        await composer.getByRole("button", { name: "Post" }).click();
        await page.getByText(posts[c.name].slice(0, 20)).first().waitFor();
        console.log(`${c.name} posted`);
      }
      await context.close();
    }
    // A livelier world: everyone follows each other, a few likes and comments.
    for (const c of CLIENTS) {
      const { context, page } = await phone(browser);
      await logIn(page, c.email);
      for (const other of CLIENTS.filter((o) => o !== c)) {
        await page.goto(`/people?q=${encodeURIComponent(other.name)}`);
        const link = page.getByRole("link", { name: new RegExp(other.name) }).first();
        if (!(await link.count())) continue;
        await link.click();
        const follow = page.getByRole("button", { name: /^Follow( back)?$/ });
        if (await follow.count()) await follow.first().click().catch(() => {});
        await pause(page, 400);
      }
      await context.close();
    }
    {
      // Leo likes Sam's post; Priya likes it and comments.
      for (const [who, comment] of [[CLIENTS[2], null], [CLIENTS[1], "Strong work Sam! 💪"]]) {
        const { context, page } = await phone(browser);
        await logIn(page, who.email);
        await page.goto("/feed");
        const post = page.getByRole("article", { name: /Post by Sam Carter/ }).first();
        if (await post.count()) {
          const like = post.getByRole("button", { name: "Like" });
          if (await like.count()) await like.click();
          if (comment && !(await post.getByRole("link", { name: /Comments \([1-9]/ }).count())) {
            await post.getByRole("link", { name: /Comments/ }).click();
            await page.getByLabel("Add a comment").fill(comment);
            await page.getByRole("button", { name: "Comment", exact: true }).click();
            await pause(page, 800);
          }
        }
        await context.close();
      }
      console.log("follows, likes and comment");
    }
    // A gym and some free session times for the next few days.
    {
      const { context, page } = await phone(browser);
      await logIn(page, TRAINER.email);
      await page.goto("/dashboard/workspace");
      if (!(await page.getByText("Iron Works Gym").count())) {
        await page.getByLabel("Gym name").filter({ visible: true }).fill("Iron Works Gym");
        await page.getByLabel("Address or area (optional)").filter({ visible: true }).fill("Kirkstall Road, Leeds");
        await page.getByRole("button", { name: "Add gym" }).click();
        await pause(page, 1000);
        console.log("gym added");
      }
      for (let d = 1; d <= 4; d++) {
        const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + d * 86_400_000));
        await page.goto(`/dashboard/bookings?view=day&date=${key}`);
        const schedule = page.getByRole("group", { name: /^Schedule for/ });
        for (const hour of ["07:00", "12:00", "18:00"]) {
          if (await schedule.getByText("Free time").count() >= 3) break;
          await schedule.getByRole("link", { name: `Add something at ${hour}` }).click({ position: { x: 20, y: 20 } });
          await page.waitForLoadState("networkidle");
          await page.getByRole("button", { name: "Add session time" }).click();
          await pause(page, 800);
        }
      }
      await context.close();
      console.log("session times added");
    }
    // Sam has a confirmed session; Leo has a request waiting.
    for (const c of [CLIENTS[0], CLIENTS[2]]) {
      const { context, page } = await phone(browser);
      await logIn(page, c.email);
      console.log(`${c.name} booking: ${(await bookNext(page)) ? "requested" : "not possible (already booked or no free times)"}`);
      await context.close();
    }
    {
      const { context, page } = await phone(browser);
      await logIn(page, TRAINER.email);
      for (let d = 1; d <= 4; d++) {
        const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + d * 86_400_000));
        await page.goto(`/dashboard/bookings?view=day&date=${key}`);
        const request = page.getByRole("listitem").filter({ hasText: "Sam Carter" }).getByRole("button", { name: "Confirm" });
        if (await request.count()) {
          await request.first().click();
          console.log("Sam's session confirmed");
          break;
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

// A client books their trainer's next free time (as in e2e/bookings.spec.ts).
async function bookNext(page, { filmed = false } = {}) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My training" }).click();
  await page.getByRole("region", { name: "Your trainers" }).getByRole("link", { name: /Reid Strength/ }).click();
  await page.waitForURL(/\/w\//);
  if (filmed) await page.film();
  const book = page.getByRole("link", { name: "Book a session" }).filter({ visible: true });
  if (!(await book.first().waitFor({ timeout: 10000 }).then(() => true, () => false))) return false;
  await pause(page, filmed ? 900 : 0);
  await book.first().click();
  await pause(page, filmed ? 900 : 0);
  await page.waitForURL(/\/book\//);
  const free = page.getByRole("region", { name: "Free times" }).getByRole("link", { name: /\d{2}:\d{2}–\d{2}:\d{2}/ }).first();
  await free.or(page.getByRole("link", { name: /^Next free time/ })).first().waitFor({ timeout: 15000 });
  // "Next free time" appears only when this week has no free times left.
  if (!(await free.count())) {
    await page.getByRole("link", { name: /^Next free time/ }).click();
    await pause(page, filmed ? 900 : 300);
  }
  if (!(await free.count())) return false;
  await free.click();
  await page.waitForLoadState("networkidle");
  await pause(page, filmed ? 1200 : 0);
  const request = page.getByRole("region", { name: "Your chosen time" }).getByRole("button", { name: "Request this time" });
  await request.waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: join(here, "raw", "booking-problem.png"), fullPage: true });
    throw new Error(`No "Request this time" at ${page.url()} (screenshot: marketing/footage/raw/booking-problem.png)`);
  });
  await request.click();
  await pause(page, filmed ? 2000 : 500);
  return true;
}

// Each clip is one phone session filmed with Chrome's screencast at full
// phone resolution (1170 x 2532), from the moment page.film() is called
// (after logging in, off camera), saved as clips/<name>.mp4.
async function clip(browser, name, run) {
  const dir = join(here, "raw", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { context, page } = await phone(browser);
  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  page.film = async () => {
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1170, maxHeight: 2532, everyNthFrame: 1 });
    await pause(page, 300);
  };
  let end;
  try {
    await run(page, browser);
    await pause(page, 1200);
    end = Date.now() / 1000;
    await cdp.send("Page.stopScreencast").catch(() => {});
  } finally {
    await context.close();
  }
  // Each frame lasts until the next one (the screencast only sends changes).
  const list = frames
    .map((f, i) => `file '${f.file.replaceAll("\\", "/")}'\nduration ${Math.max(0.01, (frames[i + 1]?.t ?? end) - f.t).toFixed(3)}`)
    .join("\n");
  writeFileSync(join(dir, "list.txt"), `${list}\nfile '${frames.at(-1).file.replaceAll("\\", "/")}'\n`);
  mkdirSync(join(here, "clips"), { recursive: true });
  const out = join(here, "clips", `${name}.mp4`);
  const run2 = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"),
    "-vf", "scale=1170:2532:force_original_aspect_ratio=decrease,pad=1170:2532:(ow-iw)/2:(oh-ih)/2:color=0x07080c,fps=30,format=yuv420p",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", out,
  ], { encoding: "utf8" });
  if (run2.status !== 0) throw new Error(`FFmpeg: ${run2.stderr.split("\n").slice(-4).join("\n")}`);
  rmSync(dir, { recursive: true, force: true });
  console.log(`clip: ${name} (${frames.length} frames)`);
}

// Logs in off camera, then starts filming on the page that matters.
async function signedIn(page, email, path) {
  await logIn(page, email);
  await page.goto(path);
  await pause(page, 500);
  await page.film();
}

async function record() {
  const browser = await chromium.launch();
  const only = process.argv[3];
  const want = (n) => !only || only === n;
  try {
    if (want("trainer-home")) await clip(browser, "trainer-home", async (page) => {
      await signedIn(page, TRAINER.email, "/dashboard");
      await pause(page, 900);
      await scroll(page, 520, 1800);
      await scroll(page, 520, 1800);
      await scroll(page, -1040, 1200);
    });
    if (want("invite")) await clip(browser, "invite", async (page) => {
      await signedIn(page, TRAINER.email, "/dashboard/clients");
      await pause(page, 800);
      await page.getByRole("button", { name: "Create invite link" }).click();
      await page.getByRole("textbox", { name: "Invite link" }).waitFor();
      await pause(page, 900);
      await page.getByRole("button", { name: /Copy/ }).first().click().catch(() => {});
      await pause(page, 1500);
    });
    if (want("join")) {
      const t = await phone(browser);
      await logIn(t.page, TRAINER.email);
      const link = await invite(t.page);
      await t.context.close();
      await clip(browser, "join", async (page) => {
        await page.goto(link);
        await page.film();
        await pause(page, 1500);
        await page.getByRole("button", { name: "Create an account to join" }).click();
        await pause(page, 600);
        await type(page.getByLabel("Your name"), "Mia Thompson");
        await type(page.getByLabel("Email"), `mia.${String(Date.now()).slice(-5)}@liftruna.test`);
        await page.getByLabel("Password").fill(PASSWORD);
        await page.getByLabel("I confirm I am 18 or over").check();
        await page.getByLabel(/I accept the beta terms/).check();
        await pause(page, 500);
        await page.getByRole("button", { name: "Create account" }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/invite"), { timeout: 30_000 });
        await pause(page, 2000);
      });
    }
    if (want("feed")) await clip(browser, "feed", async (page) => {
      // Off camera: remove the copies earlier recordings posted.
      await logIn(page, CLIENTS[1].email);
      await page.goto("/feed");
      page.on("dialog", (d) => d.accept()); // "Delete this post for good?"
      await page.getByRole("article").first().waitFor();
      for (let i = 0; i < 10; i++) {
        const old = page.getByRole("article", { name: /Post by Priya Shah/ }).filter({ hasText: "Saturday long run" }).first();
        if (!(await old.count())) break;
        await old.getByRole("button", { name: "Delete" }).click();
        await pause(page, 1500);
      }
      await page.goto("/feed");
      await pause(page, 500);
      await page.film();
      const composer = page.getByRole("region", { name: "New post" });
      await composer.getByText("What did you train today?").click();
      await type(composer.getByLabel("Share an update"), "Saturday long run with the crew. 10k done!");
      await pause(page, 500);
      await composer.getByRole("button", { name: "Post" }).click();
      await pause(page, 1500);
      await scroll(page, 560, 1600);
      const like = page.getByRole("article", { name: /Post by Sam Carter/ }).first().getByRole("button", { name: "Like" });
      if (await like.count()) {
        await like.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
        await pause(page, 1300);
        await like.click();
      }
      await pause(page, 1500);
    });
    if (want("plan")) await clip(browser, "plan", async (page) => {
      await signedIn(page, TRAINER.email, "/dashboard/programmes");
      const name = page.getByLabel("Programme name").filter({ visible: true });
      await type(name, "Strength Block");
      await page.getByRole("button", { name: "Create programme" }).click();
      await page.getByRole("heading", { level: 1, name: "Strength Block" }).waitFor();
      await pause(page, 600);
      await type(page.getByLabel("New workout name").filter({ visible: true }), "Day 1: Lower");
      await page.getByRole("button", { name: "Add workout" }).click();
      const workout = page.getByRole("group", { name: "Day 1: Lower" });
      await workout.getByText("Add an exercise").click();
      await type(workout.getByLabel("Exercise"), "Back squat");
      await workout.getByLabel("Sets").fill("4");
      await workout.getByLabel("Reps").fill("6-8");
      await workout.getByRole("button", { name: "Add exercise" }).click();
      await pause(page, 900);
      await page.getByLabel("Client").filter({ visible: true }).selectOption({ label: "Sam Carter" });
      await pause(page, 500);
      await page.getByRole("button", { name: "Assign programme" }).click();
      await pause(page, 1800);
    });
    if (want("booking")) await clip(browser, "booking", async (page) => {
      await logIn(page, CLIENTS[1].email);
      await page.goto("/feed");
      await bookNext(page, { filmed: true });
    });
    if (want("confirm")) await clip(browser, "confirm", async (page) => {
      await logIn(page, TRAINER.email);
      for (let d = 1; d <= 4; d++) {
        const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + d * 86_400_000));
        await page.goto(`/dashboard/bookings?view=day&date=${key}`);
        const confirm = page.getByRole("listitem").filter({ hasText: /Priya Shah|Leo Bennett/ }).getByRole("button", { name: "Confirm" });
        if (await confirm.count()) {
          await page.film();
          await confirm.first().evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
          await pause(page, 1500);
          await confirm.first().click();
          await pause(page, 2200);
          break;
        }
      }
    });
    if (want("trainer-page")) await clip(browser, "trainer-page", async (page) => {
      await page.goto(`/t/${TRAINER.slug}`);
      await page.film();
      await pause(page, 1500);
      await scroll(page, 600, 1800);
      await scroll(page, 600, 1800);
    });
  } finally {
    await browser.close();
  }
}

if (mode === "seed") await seed();
else if (mode === "record") await record();
else console.log("Use: seed | record [clip-name]");
