// Makes a 20 to 30 second vertical video (1080 x 1920 MP4) for a post (D86):
//   1. hook: the opening line punches in word by word,
//   2. the problem or promise, line by line,
//   3. three app scenes: a real screen in a phone, zooming and panning, with
//      a title and a label popping in,
//   4. quick-fire: the post's points (or three short words) cut in fast,
//   5. for questions: A or B cards slam in,
//   6. end card: logo, "DM us BETA", liftruna.com.
// Built as an animated web page, recorded frame by frame (30 fps) with the
// browser the tests use, then joined with FFmpeg (silent track, so a trending
// sound can be added by hand on TikTok). Same method as marketing/tiktok.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const bank = JSON.parse(readFileSync(new URL("../data/ideas.json", import.meta.url), "utf8"));
const source = fileURLToPath(new URL("../../tiktok/source/", import.meta.url));
const base = pathToFileURL(source).href;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const FPS = 30;

// Which three app screens to show: the post's own, then others for its audience.
function screensFor(post) {
  const files = Object.fromEntries(Object.entries(bank.screens).map(([k, v]) => [v.file, k]));
  const own = [...(post.stepScreens ?? []), post.screen].filter(Boolean).map((f) => files[f]).filter(Boolean);
  const extra = post.audience === "trainers" ? ["trainerHome", "inviteLink", "clients", "publicPage"] : ["feed", "composer", "comments", "inviteOpen"];
  return [...new Set([...own, ...extra])].slice(0, 3).map((k) => bank.screens[k]);
}

// Three short beats for the quick-fire scene.
function beats(post) {
  if (post.points?.length) return post.points.slice(0, 4).map(([b]) => b);
  return post.audience === "trainers" ? ["Plans.", "Bookings.", "Messages.", "One app."] : ["Train.", "Share.", "Get support.", "Together."];
}

export function reelHtml(post) {
  const words = esc(post.hook).split(/\s+/).map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`).join(" ");
  const subLines = (post.sub || (post.eventName ? `${post.days} days to ${post.eventName}` : ""))
    .split(/(?<=[.?!])\s+/)
    .filter(Boolean)
    .slice(0, 3);
  const scenes = screensFor(post);
  // Everything shown is escaped: the page builds its scenes from these.
  const data = {
    eyebrow: esc(post.eyebrow),
    subLines: subLines.map(esc),
    scenes: scenes.map((s) => ({ img: esc(s.file), title: esc(s.title), line: esc(s.line) })),
    beats: beats(post).map(esc),
    options: post.options ? post.options.map(esc) : null,
    days: post.days ?? null,
    eventName: post.eventName ? esc(post.eventName) : null,
    cta: esc(post.ctaShort || "DM us BETA"),
    ctaLine: esc(post.cta ?? ""),
  };
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${base}"><link rel="stylesheet" href="base.css"><style>
html, body { width: 1080px; height: 1920px; }
.scene { position: absolute; inset: 0; opacity: 0; }
.brandbar { position: absolute; top: 120px; left: 0; right: 0; display: flex; justify-content: center; z-index: 20; }
.brandbar .brand { position: static; }
.brandbar img { width: 56px; height: 56px; border-radius: 14px; }
.brandbar span { font-size: 32px; }
.center { position: absolute; left: 80px; right: 80px; top: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding-bottom: 120px; }
.grad { background: linear-gradient(100deg, #a78bfa 0%, #d946ef 60%, #f0abfc 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hook { font-family: "Bricolage"; font-weight: 800; font-size: 128px; letter-spacing: -.045em; line-height: .98; }
.hook .w { display: inline-block; }
.hook .w:nth-child(3n) { background: linear-gradient(100deg, #a78bfa, #d946ef 60%, #f0abfc); -webkit-background-clip: text; background-clip: text; color: transparent; }
.eyebrow { font-size: 30px; margin-bottom: 40px; }
.line { font-family: "Bricolage"; font-weight: 700; font-size: 72px; letter-spacing: -.03em; line-height: 1.08; margin: 18px 0; }
.count { font-family: "Bricolage"; font-weight: 800; font-size: 420px; line-height: .8; letter-spacing: -.06em; }
.head { position: absolute; top: 250px; left: 80px; right: 80px; text-align: center; }
.title { font-family: "Bricolage"; font-weight: 800; font-size: 92px; letter-spacing: -.04em; line-height: 1; }
.desc { font-size: 36px; color: #cbd2e0; margin-top: 18px; line-height: 1.3; }
.phone { left: 50%; margin-left: -270px; top: 640px; width: 540px; height: 1120px; }
.phone .screen img { transform-origin: 50% 20%; }
.chip { position: absolute; z-index: 6; padding: 18px 28px; border-radius: 22px; font-family: "Bricolage"; font-weight: 700; font-size: 34px;
  background: rgba(15,17,23,.92); border: 1.5px solid rgba(196,181,253,.7); box-shadow: 0 0 40px rgba(139,92,246,.55); }
.beat { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 80px;
  font-family: "Bricolage"; font-weight: 800; font-size: 120px; letter-spacing: -.045em; line-height: 1; opacity: 0; }
.opts { display: flex; gap: 40px; margin-top: 80px; width: 100%; }
.opt { flex: 1; border-radius: 40px; padding: 60px 40px; border: 2px solid rgba(196,181,253,.6); background: rgba(139,92,246,.16); box-shadow: 0 0 50px rgba(139,92,246,.4); text-align: left; }
.opt b { display: block; font-family: "Bricolage"; font-weight: 800; font-size: 170px; line-height: 1; }
.opt span { display: block; font-family: "Bricolage"; font-weight: 700; font-size: 56px; margin-top: 20px; }
.biglogo { width: 240px; height: 240px; border-radius: 56px; box-shadow: 0 0 90px rgba(139,92,246,.75), 0 0 180px rgba(217,70,239,.35); }
.cta { font-family: "Bricolage"; font-weight: 800; font-size: 140px; letter-spacing: -.045em; line-height: .95; margin-top: 60px; }
.ctaline { font-size: 38px; color: #cbd2e0; margin-top: 30px; max-width: 860px; line-height: 1.35; }
.end .pill { font-size: 26px; padding: 13px 22px 13px 28px; margin-top: 60px; }
.end .url { font-size: 54px; margin-top: 50px; padding: 22px 44px; border-radius: 28px; }
.bar { position: absolute; left: 0; top: 0; height: 8px; width: 1080px; transform-origin: 0 0; background: linear-gradient(90deg, #8b5cf6, #d946ef); z-index: 30; }
</style></head><body>
<div class="glow g-purple" id="g1" style="width:1200px;height:1200px;left:-60px;top:520px"></div>
<div class="glow g-magenta" id="g2" style="width:700px;height:700px;left:-300px;top:1100px"></div>
<div class="glow g-magenta" id="g3" style="width:700px;height:700px;right:-300px;top:150px;opacity:.75"></div>
<div class="grid"></div><div class="noise"></div>
<div class="bar" id="bar"></div>
<div class="brandbar" id="brandbar" style="opacity:0"><div class="brand"><img src="logo.png"><span>LiftRuna</span></div></div>
<div id="stage"></div>
<script>
const D = ${JSON.stringify(data)};
const HOOK = ${JSON.stringify(words)};
const stage = document.getElementById("stage");
const ease = "cubic-bezier(.2,.8,.2,1)";
const anim = (el, frames, start, dur, opts = {}) => el.animate(frames, { delay: start * 1000, duration: dur * 1000, fill: "both", easing: ease, ...opts });
const add = (html, cls = "scene") => { const el = document.createElement("div"); el.className = cls; el.innerHTML = html; stage.appendChild(el); return el; };
const show = (el, t, d, fade = .35) => { anim(el, [{ opacity: 0 }, { opacity: 1 }], t, fade, { easing: "linear" }); anim(el, [{ opacity: 1 }, { opacity: 0 }], t + d, fade, { easing: "linear", fill: "forwards" }); };
let t = 0;

// 1. Hook: words punch in.
{
  const el = add('<div class="center"><div class="eyebrow">' + D.eyebrow + '</div><div class="hook">' + HOOK + '</div></div>');
  const n = el.querySelectorAll(".w").length;
  const d = Math.max(3.2, 1.2 + n * 0.28);
  show(el, t, d, .2);
  anim(el.querySelector(".eyebrow"), [{ opacity: 0, transform: "translateY(20px)" }, { opacity: 1, transform: "none" }], t, .5);
  el.querySelectorAll(".w").forEach((w, i) => anim(w, [{ opacity: 0, transform: "scale(1.8)" }, { opacity: 1, transform: "scale(.96)", offset: .7 }, { opacity: 1, transform: "none" }], t + .25 + i * .26, .45));
  anim(el.querySelector(".hook"), [{ transform: "scale(1)" }, { transform: "scale(1.06)" }], t, d + .2, { easing: "linear" });
  t += d;
}

// 2. Countdown or the promise, line by line.
if (D.days != null && D.eventName) {
  const el = add('<div class="center"><div class="count grad">' + D.days + '</div><div class="line">days to ' + D.eventName + '</div></div>');
  show(el, t, 3);
  anim(el.querySelector(".count"), [{ opacity: 0, transform: "scale(.4)" }, { opacity: 1, transform: "scale(1.08)", offset: .6 }, { opacity: 1, transform: "none" }], t + .1, .7);
  anim(el.querySelector(".line"), [{ opacity: 0, transform: "translateY(40px)" }, { opacity: 1, transform: "none" }], t + .5, .6);
  t += 3;
}
if (D.subLines.length) {
  const el = add('<div class="center">' + D.subLines.map((l) => '<div class="line">' + l + '</div>').join("") + '</div>');
  const d = 1.4 + D.subLines.length * 1.1;
  show(el, t, d);
  el.querySelectorAll(".line").forEach((l, i) => anim(l, [{ opacity: 0, transform: "translateY(60px)", filter: "blur(8px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], t + .2 + i * .9, .6));
  t += d;
}

// 3. App scenes: phone in, screen zooms and pans, label pops.
D.scenes.forEach((s, i) => {
  const left = i % 2 === 0;
  const el = add('<div class="head"><div class="title">' + s.title + '</div><div class="desc">' + s.line + '</div></div>' +
    '<div class="phone"><div class="screen"><img src="' + s.img + '"></div></div>' +
    '<div class="chip" style="top:' + (1150 + i * 90) + 'px;' + (left ? "left:70px" : "right:70px") + '">' + ["See it all", "One tap", "Real app"][i % 3] + '</div>');
  const d = 4.2;
  show(el, t, d);
  anim(el.querySelector(".title"), [{ opacity: 0, transform: "translateY(50px)" }, { opacity: 1, transform: "none" }], t + .1, .6);
  anim(el.querySelector(".desc"), [{ opacity: 0, transform: "translateY(30px)" }, { opacity: 1, transform: "none" }], t + .3, .6);
  anim(el.querySelector(".phone"), [{ opacity: 0, transform: "translateY(300px) rotate(" + (left ? -6 : 6) + "deg) scale(.9)" }, { opacity: 1, transform: "translateY(0) rotate(0) scale(1)" }], t + .1, .8);
  anim(el.querySelector(".phone img"), [{ transform: "scale(1) translateY(0)" }, { transform: "scale(1.32) translateY(" + (i % 2 ? -8 : -14) + "%)" }], t + .9, d - .6, { easing: "ease-in-out" });
  anim(el.querySelector(".chip"), [{ opacity: 0, transform: "scale(.3) rotate(-8deg)" }, { opacity: 1, transform: "scale(1.1) rotate(" + (left ? -3 : 3) + "deg)", offset: .6 }, { opacity: 1, transform: "rotate(" + (left ? -3 : 3) + "deg)" }], t + 1.6, .5);
  document.getElementById("brandbar").animate([{ opacity: 0 }, { opacity: 1, offset: .1 }, { opacity: 1, offset: .9 }, { opacity: 0 }], { delay: t * 1000, duration: d * 1000, fill: "none" });
  t += d;
});

// 4. Quick-fire beats: hard cuts.
D.beats.forEach((b, i) => {
  const el = add(b, "beat");
  el.classList.add(i % 2 ? "grad" : "x");
  anim(el, [{ opacity: 0, transform: "scale(1.5)" }, { opacity: 1, transform: "scale(1)", offset: .25 }, { opacity: 1, transform: "scale(.97)", offset: .9 }, { opacity: 0, transform: "scale(.95)" }], t, .95, { easing: "linear", fill: "none" });
  t += .95;
});

// 5. Questions: A or B.
if (D.options) {
  const el = add('<div class="center"><div class="line">Which one are you?</div><div class="opts"><div class="opt"><b class="grad">A</b><span>' + D.options[0] + '</span></div><div class="opt"><b class="grad">B</b><span>' + D.options[1] + '</span></div></div><div class="ctaline">Comment A or B</div></div>');
  show(el, t, 4);
  el.querySelectorAll(".opt").forEach((o, i) => anim(o, [{ opacity: 0, transform: "translateY(200px) scale(.8)" }, { opacity: 1, transform: "none" }], t + .3 + i * .35, .6));
  t += 4;
}

// 6. End card.
{
  const el = add('<div class="center end"><img class="biglogo" src="logo.png"><div class="cta grad">' + D.cta + '</div><div class="ctaline">' + D.ctaLine + '</div><span class="pill">CLOSED BETA</span><div class="url">liftruna.com</div></div>');
  anim(el, [{ opacity: 0 }, { opacity: 1 }], t, .35, { easing: "linear" });
  [...el.querySelector(".center").children].forEach((c, k) => anim(c, [{ opacity: 0, transform: "translateY(50px) scale(.95)" }, { opacity: 1, transform: "none" }], t + .15 + k * .2, .7));
  t += 4.2;
}

const total = t;
anim(document.getElementById("bar"), [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], 0, total, { easing: "linear" });
anim(document.getElementById("g1"), [{ transform: "translate(0,0)" }, { transform: "translate(80px,-160px)" }], 0, total, { easing: "ease-in-out" });
anim(document.getElementById("g2"), [{ transform: "translate(0,0)" }, { transform: "translate(160px,-120px)" }], 0, total, { easing: "ease-in-out" });
anim(document.getElementById("g3"), [{ transform: "translate(0,0)" }, { transform: "translate(-140px,180px)" }], 0, total, { easing: "ease-in-out" });
window.TOTAL = total;
window.seek = (sec) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = sec * 1000; } };
</script></body></html>`;
}

export async function makeReel(post, dir) {
  const html = join(dir, "reel.html");
  writeFileSync(html, reelHtml(post));
  const frames = join(dir, "frames");
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const browser = await chromium.launch();
  let total;
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await page.goto(`file:///${html.replaceAll("\\", "/")}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    total = await page.evaluate(() => window.TOTAL);
    const n = Math.round(total * FPS);
    for (let i = 0; i < n; i++) {
      await page.evaluate((s) => window.seek(s), i / FPS);
      await page.screenshot({ path: join(frames, `${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 90 });
    }
  } finally {
    await browser.close();
  }
  const out = join(dir, "video.mp4");
  const run = spawnSync(
    process.env.FFMPEG_PATH || "ffmpeg",
    ["-y", "-framerate", String(FPS), "-i", join(frames, "%05d.jpg"), "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-shortest", "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`FFmpeg failed: ${(run.stderr || "").split("\n").slice(-6).join("\n")}`);
  rmSync(frames, { recursive: true, force: true });
  return { file: out, seconds: Math.round(total) };
}
