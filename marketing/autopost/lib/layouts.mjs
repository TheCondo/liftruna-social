// Post layouts (D86). Each returns the HTML for one or more 1080 x 1350
// slides, drawn around real, unedited LiftRuna screenshots of demo accounts.
// Style matches the existing posts (marketing/instagram, marketing/tiktok).
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const source = join(fileURLToPath(new URL("../../tiktok/source/", import.meta.url)));
const base = pathToFileURL(source + "/").href;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Small seeded random so a post always draws the same way.
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

const themes = [
  { a: "#a78bfa", b: "#d946ef", c: "#f0abfc", glow1: "g-purple", glow2: "g-magenta" },
  { a: "#22d3ee", b: "#8b5cf6", c: "#a5f3fc", glow1: "g-purple", glow2: "g-cyan" },
  { a: "#f0abfc", b: "#8b5cf6", c: "#fde68a", glow1: "g-magenta", glow2: "g-purple" },
];

// Bigger text for shorter hooks.
const size = (text, max, min) => Math.max(min, Math.min(max, Math.round(max - (text.length - 14) * 2.4)));

function frame(body, { theme, r, extra = "" }) {
  const g = () => Math.round(r() * 600 - 200);
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${base}"><link rel="stylesheet" href="base.css"><style>
.g-cyan { background: radial-gradient(circle, rgba(34,211,238,.55), rgba(34,211,238,0) 70%); }
h1 .grad, .grad { background: linear-gradient(100deg, ${theme.a} 0%, ${theme.b} 60%, ${theme.c} 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.eyebrow { color: ${theme.c}; }
.brand { top: 60px; left: 72px; }
.cta { position: absolute; left: 72px; right: 72px; bottom: 64px; display: flex; align-items: center; justify-content: space-between; }
.cta .pill { font-size: 18px; }
.cta b { display: block; font-family: "Bricolage"; font-weight: 800; font-size: 38px; letter-spacing: -.02em; margin-top: 10px; }
.cta .url { font-size: 30px; padding: 12px 22px; }
.features.list b { font-size: 34px; }
.features.list small { font-size: 23px; }
${extra}
</style></head><body>
<div class="glow ${theme.glow1}" style="width:900px;height:900px;left:${g() + 200}px;top:${g() + 400}px"></div>
<div class="glow ${theme.glow2}" style="width:560px;height:560px;left:${g()}px;top:${g() + 600}px;opacity:.8"></div>
<div class="grid"></div><div class="noise"></div>
<div class="brand"><img src="logo.png"><span>LiftRuna</span></div>
${body}
</body></html>`;
}

const ctaBand = (post) => `<div class="cta"><div><span class="pill">CLOSED BETA</span><b>${esc(post.ctaShort)}</b></div><div class="url">liftruna.com</div></div>`;
const phone = (file, style) => `<div class="phone" style="${style}"><div class="screen"><img src="${esc(file)}"></div></div>`;

function hook(post, ctx) {
  const left = ctx.r() < 0.5;
  const body = `
<div style="position:absolute;top:190px;${left ? "left:72px" : "right:72px"};width:560px;${left ? "" : "text-align:right"}">
  <div class="eyebrow">${esc(post.eyebrow)}</div>
  <h1 style="font-size:${size(post.hook, 98, 64)}px;margin-top:22px">${esc(post.hook)}</h1>
  <p class="sub" style="margin-top:26px">${esc(post.sub)}</p>
</div>
${phone(post.screen, `z-index:3;${left ? "right:70px" : "left:70px"};top:230px;width:360px;height:752px;transform:rotate(${left ? 3 : -3}deg)`)}
${ctaBand(post)}`;
  return [frame(body, ctx)];
}

function countdown(post, ctx) {
  const body = `
<div style="position:absolute;top:170px;left:72px;right:72px">
  <div class="eyebrow">${esc(post.eyebrow)}</div>
  <div style="display:flex;align-items:flex-end;gap:28px;margin-top:10px">
    <div class="grad" style="font-family:Bricolage;font-weight:800;font-size:300px;line-height:.85;letter-spacing:-.06em">${esc(post.days)}</div>
    <div style="font-family:Bricolage;font-weight:800;font-size:54px;line-height:1;padding-bottom:22px">days to<br>${esc(post.eventName)}</div>
  </div>
  <h1 style="font-size:${size(post.hook, 66, 48)}px;margin-top:46px;width:560px">${esc(post.hook)}</h1>
  <p class="sub" style="margin-top:20px;width:540px">${esc(post.sub)}</p>
</div>
${phone(post.screen, "z-index:3;right:70px;top:470px;width:300px;height:626px;transform:rotate(4deg)")}
${ctaBand(post)}`;
  return [frame(body, ctx)];
}

function spotlight(post, ctx) {
  const tags = post.points
    .map(([b, s], i) => `<li><span class="n">${i + 1}</span><div><b>${esc(b)}</b><small>${esc(s)}</small></div></li>`)
    .join("");
  const body = `
<div style="position:absolute;top:180px;left:72px;width:540px">
  <div class="eyebrow">${esc(post.eyebrow)}</div>
  <h1 style="font-size:${size(post.hook, 88, 60)}px;margin-top:20px">${esc(post.hook)}</h1>
  <ul class="features" style="margin-top:56px">${tags}</ul>
</div>
${phone(post.screen, "z-index:3;right:66px;top:250px;width:350px;height:730px")}
${ctaBand(post)}`;
  return [frame(body, ctx)];
}

function question(post, ctx) {
  const [a, b] = post.options;
  const opt = (letter, text) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;border-radius:34px;padding:52px 44px;border:1.5px solid rgba(196,181,253,.5);background:rgba(139,92,246,.12);box-shadow:0 0 40px rgba(139,92,246,.3)">
    <div class="grad" style="font-family:Bricolage;font-weight:800;font-size:160px;line-height:1">${letter}</div>
    <div style="font-family:Bricolage;font-weight:700;font-size:52px;margin-top:14px;letter-spacing:-.02em">${esc(text)}</div></div>`;
  const body = `
<div style="position:absolute;top:250px;left:72px;right:72px;text-align:center">
  <div class="eyebrow">${esc(post.eyebrow)}</div>
  <h1 style="font-size:${size(post.hook, 112, 74)}px;margin-top:30px">${esc(post.hook)}</h1>
  <div style="display:flex;gap:36px;margin-top:90px;text-align:left;min-height:400px">${opt("A", a)}${opt("B", b)}</div>
  <p class="sub" style="margin-top:60px;font-size:36px">Comment A or B ↓</p>
</div>
${ctaBand(post)}`;
  return [frame(body, ctx)];
}

function tip(post, ctx) {
  const body = `
<div style="position:absolute;top:250px;left:90px;right:90px">
  <div class="eyebrow">${esc(post.eyebrow)}</div>
  <div style="width:140px;height:14px;border-radius:7px;margin-top:60px;background:linear-gradient(90deg, ${ctx.theme.a}, ${ctx.theme.b})"></div>
  <h1 style="font-size:${size(post.hook, 118, 78)}px;margin-top:48px">${esc(post.hook)}</h1>
  <p class="sub" style="margin-top:40px;font-size:34px;width:820px">${esc(post.sub)}</p>
</div>
${ctaBand(post)}`;
  return [frame(body, ctx)];
}

// Carousels: a cover, one slide per point (or all points), and a closing slide.
function cover(post, ctx) {
  const body = `
<div style="position:absolute;top:300px;left:72px;right:72px">
  <div class="eyebrow">${esc(post.eyebrow)}</div>
  <h1 style="font-size:${size(post.hook, 124, 84)}px;margin-top:26px">${esc(post.hook)}</h1>
  ${ctx.format === "carousel" ? '<p class="sub" style="margin-top:40px;font-size:32px">Swipe →</p>' : ""}
</div>`;
  return frame(body, ctx);
}

function closing(post, ctx) {
  const body = `
<div style="position:absolute;top:330px;left:72px;right:72px;text-align:center">
  <h1 style="font-size:96px"><span class="grad">${esc(post.ctaShort)}</span></h1>
  <p class="sub" style="margin-top:34px;font-size:32px">${esc(post.cta)}</p>
  <div class="url" style="display:inline-block;margin-top:60px">liftruna.com</div>
</div>`;
  return frame(body, ctx);
}

function steps(post, ctx) {
  const slides = [cover(post, ctx)];
  post.points.forEach(([b, s], i) => {
    const body = `
<div style="position:absolute;top:330px;left:72px;width:540px">
  <div class="grad" style="font-family:Bricolage;font-weight:800;font-size:260px;line-height:.85">${i + 1}</div>
  <h1 style="font-size:80px;margin-top:30px">${esc(b)}</h1>
  <p class="sub" style="margin-top:24px;font-size:32px">${esc(s)}</p>
</div>
${post.stepScreens[i] ? phone(post.stepScreens[i], `z-index:3;right:66px;top:250px;width:380px;height:794px;transform:rotate(${i % 2 ? -3 : 3}deg)`) : ""}`;
    slides.push(frame(body, ctx));
  });
  slides.push(closing(post, ctx));
  return slides;
}

function list(post, ctx) {
  const items = post.points
    .map(([b, s], i) => `<li><span class="n">${i + 1}</span><div><b>${esc(b)}</b><small>${esc(s)}</small></div></li>`)
    .join("");
  const body = `
<div style="position:absolute;top:220px;left:72px;width:600px">
  <ul class="features list" style="gap:62px">${items}</ul>
</div>
${phone(post.screen, "z-index:3;right:56px;top:300px;width:340px;height:710px;transform:rotate(-3deg)")}
${ctx.format === "carousel" ? '<p class="sub" style="position:absolute;left:72px;bottom:90px;font-size:30px">Swipe for how to join →</p>' : ""}`;
  return [cover(post, ctx), frame(body, ctx), closing(post, ctx)];
}

const layouts = { hook, countdown, spotlight, question, tip, steps, list };
export const layoutNames = Object.keys(layouts);

// Formats (D86): "single" (one picture, where the layout has one),
// "carousel" (swipe; one-picture layouts get a cover and a closing slide)
// and "video" (the same slides played in turn, made into a Reel).
export const multiSlide = (layout) => layout === "steps" || layout === "list";

export function draw(post, format = "single") {
  const r = rng(post.id);
  const theme = themes[Math.floor(r() * themes.length)];
  const ctx = { r, theme, format };
  const slides = layouts[post.layout](post, ctx);
  if (format === "single" || slides.length > 1) return slides;
  return [cover(post, ctx), ...slides, closing(post, ctx)];
}
