// The browser in the side panel: one real Chrome tab per chat that the user and the agent share.
//
// One browser for the whole server (launched on first use, system Chrome via playwright-core, no download).
// A chat's session = a tab whose every frame is streamed to the app (CDP screencast) and whose mouse and keyboard
// the app forwards back, so the user can browse in it like a normal browser. Reference scouting (`run`) drives the
// same tab: it goes to Pinterest / Google Images / Bing, scrolls, hovers, opens pins, and collects large images
// while the user watches; the user can stop it at any moment, or click a picture themselves to save it.
//
// Pacing of the scout is deliberately human-ish (short random pauses, stepped scrolling), only much faster.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { CONFIG_DIR } from './config.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SITE_NAMES = { pinterest: 'Pinterest', google: 'Google Images', bing: 'Bing Images', unsplash: 'Unsplash', pexels: 'Pexels' };
const IMG_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const IDLE_MS = 20 * 60 * 1000;     // a tab nobody touched for this long closes itself
const MIN_W = 860;                  // pages lay out at desktop width and the app scales the picture to the panel
const PROFILE_DIR = path.join(CONFIG_DIR, 'browser-profile');   // logins survive (Pinterest, Google); follows SUPACOMPUTA_HOME so two servers never share one profile
// Pinterest, signed out, covers the pin grid with a "Log in to see more" sheet that has no close button and locks the
// scroll. This runs in every Pinterest page (the agent's scouting and the user's own browsing): it lifts the sheet and
// the scroll lock whenever they appear, and leaves /login alone so signing in (kept by the profile) still works.
const PIN_UNWALL = String.raw`(() => {
  if (!/(^|\.)pinterest\.[a-z.]+$/.test(location.hostname) || /^\/(login|signup)/.test(location.pathname)) return;
  const isWall = (el) => !el.querySelector('img[src*="pinimg"]') && /log in to see more|signed out|sign up to see more|welcome to pinterest/i.test(el.innerText || '');
  const zap = () => {
    let hit = false;
    for (const el of document.querySelectorAll('[data-test-id="fullPageSignupModal"], [data-test-id="giftWrap"], div[role="dialog"]')) {
      if (!isWall(el)) continue;
      let top = el; while (top.parentElement && top.parentElement !== document.body && getComputedStyle(top.parentElement).position === 'fixed' && !top.parentElement.querySelector('img[src*="pinimg"]')) top = top.parentElement;
      top.remove(); hit = true;
    }
    if (hit || getComputedStyle(document.body).overflow === 'hidden') { document.body.style.setProperty('overflow', 'auto', 'important'); document.documentElement.style.setProperty('overflow', 'auto', 'important'); }
  };
  let queued = false; const later = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; zap(); }, 120); };
  const start = () => { zap(); new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();`;
const rnd = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Scout {
  constructor({ emit }) {
    this.emit = emit;            // (event) => void, broadcast to every app window
    this.context = null;         // one persistent profile for every chat: log in once, stay logged in
    this.launching = null;
    this.sessions = new Map();   // chatId -> { page, cdp, w, h, box, timer, url, title }
    this.runs = new Map();       // chatId -> { stop: boolean }
  }

  async launch() {
    if (this.context) return this.context;
    if (this.launching) return this.launching;
    this.launching = (async () => {
      fs.mkdirSync(PROFILE_DIR, { recursive: true });
      // Chrome first; Edge (on every Windows) when Chrome is not installed. Each channel keeps its own profile folder.
      let context = null, lastErr = null;
      for (const channel of ['chrome', 'msedge']) {
        const dir = channel === 'chrome' ? PROFILE_DIR : PROFILE_DIR + '-' + channel;
        try { context = await chromium.launchPersistentContext(dir, { channel, headless: true, viewport: { width: 1000, height: 700 }, userAgent: UA, locale: 'en-US', deviceScaleFactor: 1, args: ['--disable-blink-features=AutomationControlled', '--lang=en-US'] }); break; }
        catch (e) { lastErr = e; }
      }
      if (!context) throw new Error('No browser to browse with: install Google Chrome. ' + String(lastErr?.message || '').split('\n')[0].slice(0, 160));
      await context.addInitScript(PIN_UNWALL);
      for (const p of context.pages()) await p.close().catch(() => {});   // the profile's blank starting tab
      context.on('close', () => { this.context = null; this.sessions.clear(); });
      // popups open in the tab that spawned them (a second window would be invisible to the user)
      context.on('page', async (p) => {
        try {
          const opener = await p.opener(); if (!opener) return;
          const owner = [...this.sessions.values()].find((x) => x.page === opener); if (!owner) return;
          await p.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          const u = p.url(); await p.close();
          if (u && u !== 'about:blank') await owner.page.goto(u, { waitUntil: 'domcontentloaded' }).catch(() => {});
        } catch { /* ignore */ }
      });
      this.context = context; this.launching = null;
      return context;
    })().catch((e) => { this.launching = null; throw e; });
    return this.launching;
  }

  // ---------------------------------------------------------------- sessions (the shared tab)
  has(chatId) { const s = this.sessions.get(chatId); return Boolean(s && !s.page.isClosed()); }
  info(chatId) { const s = this.sessions.get(chatId); return s ? { url: s.url, title: s.title, w: s.w, h: s.h } : null; }
  touch(s) { clearTimeout(s.timer); s.timer = setTimeout(() => this.close(s.chatId).catch(() => {}), IDLE_MS); }

  async session(chatId, { width = 1000, height = 700 } = {}) {
    const old = this.sessions.get(chatId);
    if (old && !old.page.isClosed()) { this.touch(old); return old; }
    const context = await this.launch();
    const { w, h, box } = viewportFor(width, height);
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    await page.setViewportSize({ width: w, height: h });
    const cdp = await context.newCDPSession(page);
    const s = { chatId, page, cdp, w, h, box, timer: null, url: 'about:blank', title: '', lastFrame: 0 };
    this.sessions.set(chatId, s);
    page.on('crash', () => this.close(chatId).catch(() => {}));
    cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
      try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch { /* tab gone */ }
      const now = Date.now(); if (now - s.lastFrame < 50) return; s.lastFrame = now;
      this.emit({ t: 'bro_frame', chatId, jpeg: data, w: s.w, h: s.h });
    });
    const nav = () => { if (page.isClosed()) return; s.url = page.url(); page.title().then((t) => { s.title = t; this.emitNav(s); }).catch(() => this.emitNav(s)); };
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) nav(); });
    page.on('load', nav);
    page.on('close', () => { clearTimeout(s.timer); if (this.sessions.get(chatId) !== s) return; this.sessions.delete(chatId); this.emit({ t: 'bro_closed', chatId }); });
    await this.startCast(s);
    this.touch(s);
    this.emit({ t: 'bro_open', chatId, w, h });
    return s;
  }
  emitNav(s) { this.emit({ t: 'bro_nav', chatId: s.chatId, url: s.url, title: s.title, w: s.w, h: s.h }); }
  async startCast(s) {
    try { await s.cdp.send('Page.stopScreencast'); } catch { /* not running */ }
    // frames come out at the panel's size (the page is wider); the app maps clicks back with w / displayed width
    await s.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 62, maxWidth: Math.min(s.w, Math.round(s.box.w * 1.5)), maxHeight: Math.min(s.h, Math.round(s.box.h * 1.5)), everyNthFrame: 1 });
  }
  async close(chatId) {
    const s = this.sessions.get(chatId); if (!s) return false;
    this.sessions.delete(chatId); clearTimeout(s.timer);
    try { await s.cdp.send('Page.stopScreencast'); } catch { /* ignore */ }
    try { await s.page.close(); } catch { /* ignore */ }
    this.emit({ t: 'bro_closed', chatId });
    return true;
  }
  async resize(chatId, width, height) {
    const s = this.sessions.get(chatId); if (!s) return;
    const { w, h, box } = viewportFor(width, height);
    if (w === s.w && h === s.h && box.w === s.box.w && box.h === s.box.h) return;
    s.w = w; s.h = h; s.box = box; this.touch(s);
    await s.page.setViewportSize({ width: w, height: h }).catch(() => {});
    await this.startCast(s).catch(() => {});
    this.emitNav(s);
  }

  // What a person types in the address bar: a URL, or words to search
  async navigate(chatId, text, size) {
    const s = await this.session(chatId, size);
    const raw = String(text || '').trim(); if (!raw) return;
    const url = /^[a-z]+:\/\//i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw) ? 'https://' + raw : 'https://www.google.com/search?q=' + encodeURIComponent(raw);
    this.touch(s);
    await s.page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e) => this.emit({ t: 'bro_error', chatId, message: String(e.message || e).split('\n')[0].slice(0, 120) }));
  }
  async back(chatId) { const s = this.sessions.get(chatId); if (s) { this.touch(s); await s.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); } }
  async forward(chatId) { const s = this.sessions.get(chatId); if (s) { this.touch(s); await s.page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {}); } }
  async reload(chatId) { const s = this.sessions.get(chatId); if (s) { this.touch(s); await s.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); } }

  // Mouse and keyboard from the app, in page pixels
  async input(chatId, ev) {
    const s = this.sessions.get(chatId); if (!s || !ev) return; this.touch(s);
    const { page } = s; const x = Number(ev.x) || 0, y = Number(ev.y) || 0;
    const btn = ev.button === 2 ? 'right' : ev.button === 1 ? 'middle' : 'left';
    try {
      switch (ev.k) {
        case 'move': await page.mouse.move(x, y); break;
        case 'down': await page.mouse.move(x, y); await page.mouse.down({ button: btn }); break;
        case 'up': await page.mouse.up({ button: btn }); break;
        case 'wheel': await page.mouse.move(x, y); await page.mouse.wheel(Number(ev.dx) || 0, Number(ev.dy) || 0); break;
        case 'keydown': await page.keyboard.down(keyName(ev.key)); break;
        case 'keyup': await page.keyboard.up(keyName(ev.key)); break;
        case 'text': await page.keyboard.insertText(String(ev.text || '')); break;
        default: break;
      }
    } catch { /* a key Playwright does not know, or the tab went away */ }
  }

  // The picture under a point, at the best size the page knows: Bing's and Google's result links carry the original
  // URL, srcset has the largest candidate, Pinterest thumbnails have a 736px sibling, and inlined data: images are
  // decoded as a last resort. Downloaded as a reference.
  async pick(chatId, x, y, outDir, n) {
    const s = this.sessions.get(chatId); if (!s) throw new Error('no browser open');
    this.touch(s);
    const found = await s.page.evaluate(([px, py]) => {
      const usable = (u) => u && !/\.svg(\?|$)/i.test(u);
      const area = (im) => { const r = im.getBoundingClientRect(); return r.width * r.height; };
      let el = document.elementFromPoint(px, py); let img = null, link = null;
      for (let i = 0; el && i < 10; i++, el = el.parentElement) {
        if (el.tagName === 'IMG' && !img && usable(el.currentSrc || el.src)) img = el;
        if (!img && el.querySelectorAll) { const inner = [...el.querySelectorAll('img')].filter((im) => usable(im.currentSrc || im.src) && im.getBoundingClientRect().width > 60).sort((a, b) => area(b) - area(a))[0]; if (inner) img = inner; }
        if (el.tagName === 'A') {
          if (!link) link = el;
          const m = el.getAttribute('m'); if (m) { try { const o = JSON.parse(m); if (o.murl) return { url: o.murl, title: o.t || '', how: 'bing' }; } catch { /* not bing */ } }
          try { const u = new URL(el.href, location.href).searchParams.get('imgurl'); if (u) return { url: u, title: document.title, how: 'google' }; } catch { /* no href */ }
        }
      }
      if (link && /\.(jpe?g|png|webp)(\?|$)/i.test(link.href)) return { url: link.href, title: document.title, how: 'link' };
      if (img) {
        let u = img.currentSrc || img.src;
        if (img.srcset) { const best = img.srcset.split(',').map((c) => c.trim().split(/\s+/)).map(([cu, d]) => ({ u: cu, n: parseFloat(d) || 0 })).filter((c) => c.u).sort((a, b) => b.n - a.n)[0]; if (best) u = best.u; }
        return { url: u, title: img.alt || document.title, w: img.naturalWidth, h: img.naturalHeight, how: 'img' };
      }
      el = document.elementFromPoint(px, py);
      for (let i = 0; el && i < 8; i++, el = el.parentElement) { const bg = getComputedStyle(el).backgroundImage; const m = bg && bg.match(/url\("?(.*?)"?\)/); if (m && usable(m[1]) && !/^data:/.test(m[1])) return { url: m[1], title: document.title, how: 'bg' }; }
      return null;
    }, [Math.round(x), Math.round(y)]);
    if (!found) return null;
    let url = found.url, saved = null;
    if (/^data:image\//.test(url)) {
      const m = url.match(/^data:(image\/[a-z+]+);base64,(.*)$/i); const ext = m && IMG_EXT[m[1].toLowerCase()];
      if (m && ext) { const buf = Buffer.from(m[2], 'base64'); if (buf.length >= 8000) { fs.mkdirSync(outDir, { recursive: true }); const file = path.join(outDir, `ref-${String(n).padStart(2, '0')}-${crypto.createHash('md5').update(buf).digest('hex').slice(0, 6)}${ext}`); fs.writeFileSync(file, buf); saved = { file, bytes: buf.length }; url = ''; } }
    } else {
      url = url.replace(/\/(236x|474x|564x)\//, '/736x/');   // Pinterest thumbnails have a bigger sibling
      saved = await downloadImage(url, outDir, n, s.url);
      if (saved && saved.bytes < 8000) { try { fs.unlinkSync(saved.file); } catch { /* ignore */ } saved = null; }
    }
    if (!saved) return null;
    return { n, path: saved.file, url, page: s.url, source: siteOf(s.url), site: siteOf(s.url).toLowerCase(), title: String(found.title || '').slice(0, 120), w: found.w || null, h: found.h || null, bytes: saved.bytes };
  }

  // ---------------------------------------------------------------- the scout run (the agent browsing)
  stop(chatId) { const r = this.runs.get(chatId); if (!r) return false; r.stop = true; return true; }
  active(chatId) { return this.runs.has(chatId); }

  // Resolves with the candidates saved on disk (may be fewer than asked, or empty when stopped). The tab stays open.
  async run({ chatId, query, count = 6, sites = ['pinterest', 'pexels', 'google'], outDir, exclude = [], label = '', size }) {
    if (this.runs.has(chatId)) throw new Error('a scout is already running for this chat');
    const run = { stop: false }; this.runs.set(chatId, run);
    const found = [];
    const state = (phase, extra = {}) => this.emit({ t: 'scout_state', chatId, phase, query, label, need: count, found: found.length, ...extra });
    const seen = new Set(exclude.map((e) => String(e).toLowerCase()));
    try {
      fs.mkdirSync(outDir, { recursive: true });
      const s = await this.session(chatId, size); const page = s.page;
      const check = () => { if (run.stop) throw Object.assign(new Error('stopped'), { stopped: true }); if (page.isClosed()) throw new Error('the browser tab was closed'); this.touch(s); };
      // A share from every site, in turn (2 Pinterest, 2 Pexels, 2 Google Images for six), so the picks are diverse and
      // the user sees the tab visit each site. Sites that gave fewer than their share are topped up from the others'
      // leftover candidates afterwards, without a second visit.
      const order = sites.filter((x) => ADAPTERS[x]);
      const share = Math.max(1, Math.ceil(count / Math.max(1, order.length)));
      const leftover = new Map();
      const take = async (site, cands, need) => {
        let got = 0;
        while (cands.length && got < need && found.length < count) {
          const c = cands.shift(); check();
          const key = (c.url || '').toLowerCase(); if (!key || seen.has(key)) continue; seen.add(key);
          const saved = await downloadImage(c.url, outDir, found.length + 1, c.page || adapterHome(site));
          if (!saved) continue;
          if (saved.bytes < 12000) { try { fs.unlinkSync(saved.file); } catch { /* ignore */ } continue; } // icons, placeholders
          const item = { n: found.length + 1, path: saved.file, url: c.url, page: c.page || '', source: SITE_NAMES[site] || site, site, title: (c.title || '').slice(0, 120), w: c.w || null, h: c.h || null, bytes: saved.bytes };
          found.push(item); got++;
          this.emit({ t: 'scout_found', chatId, item, found: found.length, need: count });
          await sleep(rnd(120, 320));
        }
        return got;
      };
      for (let i = 0; i < order.length && found.length < count; i++) {
        const site = order[i]; check();
        const need = Math.min(share, count - found.length);
        state('searching', { site, siteName: SITE_NAMES[site] || site, message: `Looking on ${SITE_NAMES[site] || site} for “${query}” (${i + 1} of ${order.length} sites, ${need} to pick)` });
        let cands = [];
        try { cands = await ADAPTERS[site]({ page, query, need: Math.max(need, share) + 2, check, state, site }); }
        catch (e) { if (e.stopped) throw e; state('searching', { site, message: `${SITE_NAMES[site] || site} did not cooperate (${String(e.message || e).slice(0, 60)}), moving on` }); continue; }
        await take(site, cands, need);
        leftover.set(site, cands);
      }
      // top up from what the sites already offered, in the same order
      for (const site of order) { if (found.length >= count) break; const rest = leftover.get(site) || []; if (rest.length) { state('searching', { site, message: `Topping up from ${SITE_NAMES[site] || site}` }); await take(site, rest, count - found.length); } }
      state('done', { message: found.length ? `Picked ${found.length} of ${count}` : 'Nothing usable found' });
      return { items: found, stopped: false };
    } catch (e) {
      if (e.stopped) { state('stopped', { message: 'Stopped' }); return { items: found, stopped: true }; }
      state('error', { message: String(e.message || e).slice(0, 160) });
      throw e;
    } finally {
      this.runs.delete(chatId);
    }
  }

  async shutdown() { for (const id of [...this.sessions.keys()]) await this.close(id); try { await this.context?.close(); } catch { /* ignore */ } this.context = null; }
}

function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(Number(v) || lo))); }
// The panel box the app shows (any size) -> a viewport at least MIN_W wide with the same aspect ratio, so sites give
// their desktop layout even in a narrow panel and the picture just scales down.
function viewportFor(width, height) {
  const box = { w: clampInt(width, 240, 2400), h: clampInt(height, 200, 2000) };
  const k = Math.max(1, MIN_W / box.w);
  return { w: clampInt(box.w * k, MIN_W, 2400), h: clampInt(box.h * k, 200, 2400), box };
}
function siteOf(url) { try { const h = new URL(url).hostname.replace(/^www\./, ''); for (const [k, v] of Object.entries(SITE_NAMES)) if (h.includes(k)) return v; return h; } catch { return 'web'; } }
function adapterHome(site) { return { pinterest: 'https://www.pinterest.com/', google: 'https://www.google.com/', bing: 'https://www.bing.com/', unsplash: 'https://unsplash.com/', pexels: 'https://www.pexels.com/' }[site] || ''; }
// DOM KeyboardEvent.key → Playwright key name (they agree on almost everything)
function keyName(k) { k = String(k || ''); return k === ' ' ? 'Space' : k === 'OS' ? 'Meta' : k; }

// ---------------------------------------------------------------- human-ish moves
async function settle(page, check) { check(); await sleep(rnd(350, 900)); }
// goto that survives a script redirect during load (Google, Bing): ERR_ABORTED means "superseded", so wait for the
// page that replaced it instead of giving up on the site.
async function visit(page, url) {
  try { await page.goto(url, { waitUntil: 'domcontentloaded' }); }
  catch (e) { if (!/ERR_ABORTED/.test(String(e.message || e))) throw e; await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}); await sleep(800); }
  await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
}
// evaluate that retries once when the page navigated underneath it (Unsplash rewrites its URL after load)
async function evalSafe(page, fn, arg) {
  try { return await page.evaluate(fn, arg); }
  catch (e) { if (!/Execution context was destroyed|navigation/i.test(String(e.message || e))) throw e; await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {}); await sleep(600); return page.evaluate(fn, arg); }
}
async function wander(page, check, steps = 3) {
  // a few mouse moves and stepped scrolls, like someone reading the grid
  const vp = page.viewportSize() || { width: 1000, height: 700 };
  for (let i = 0; i < steps; i++) {
    check();
    await page.mouse.move(rnd(200, vp.width - 200), rnd(160, vp.height - 120), { steps: 8 });
    await sleep(rnd(90, 220));
    await page.mouse.wheel(0, rnd(380, 640));
    await sleep(rnd(260, 620));
  }
}
async function hoverAt(page, check, el) {
  try { const b = await el.boundingBox(); if (!b) return; check(); await page.mouse.move(b.x + b.width / 2 + rnd(-8, 8), b.y + b.height / 2 + rnd(-8, 8), { steps: 10 }); await sleep(rnd(160, 380)); } catch { /* gone */ }
}
async function dismissOverlays(page) {
  // consent / login sheets that cover the grid; best effort, never fatal
  try { await page.evaluate(PIN_UNWALL); } catch { /* not a page we can script */ }
  for (const sel of ['button:has-text("Accept all")', 'button:has-text("Reject all")', 'button:has-text("I agree")', '[aria-label="Close"]', 'button:has-text("Not now")', 'button:has-text("Maybe later")', 'div[data-test-id="fullPageSignupModal"] button:has-text("Close")']) {
    try { const b = page.locator(sel).first(); if (await b.isVisible({ timeout: 300 })) { await b.click({ timeout: 800 }); await sleep(300); } } catch { /* none */ }
  }
}

// ---------------------------------------------------------------- site adapters → [{url, page, title, w, h}]
const ADAPTERS = {
  async pinterest({ page, query, need, check, state, site }) {
    await visit(page, 'https://www.pinterest.com/search/pins/?q=' + encodeURIComponent(query));
    await settle(page, check); await dismissOverlays(page);
    const out = []; const seen = new Set();
    for (let round = 0; round < 6 && out.length < need * 2; round++) {
      await wander(page, check, 2); await dismissOverlays(page);
      const pins = await page.evaluate(() => [...document.querySelectorAll('img[src*="pinimg.com"]')].map((img) => {
        const a = img.closest('a[href*="/pin/"]'); const r = img.getBoundingClientRect();
        return { src: img.currentSrc || img.src, alt: img.alt || '', href: a ? a.href : '', w: img.naturalWidth, h: img.naturalHeight, area: r.width * r.height };
      }).filter((p) => p.area > 20000 && /\/(236x|474x|564x|736x|originals)\//.test(p.src)));
      for (const p of pins) {
        const full = p.src.replace(/\/(236x|474x|564x)\//, '/736x/');
        if (seen.has(full)) continue; seen.add(full);
        out.push({ url: full, page: p.href || 'https://www.pinterest.com/', title: p.alt, w: null, h: null });
      }
      state('searching', { site, message: `Pinterest: ${out.length} pins in view for “${query}”` });
    }
    // open a couple of pins like a person checking them, and take the original when the pin page offers it
    const picks = out.slice(0, Math.min(out.length, need));
    for (const pick of picks.slice(0, 3)) {
      check();
      if (!pick.page || !/\/pin\//.test(pick.page)) continue;
      try {
        const el = page.locator(`a[href*="${new URL(pick.page).pathname}"]`).first();
        await hoverAt(page, check, el);
        await el.click({ timeout: 4000 });
        await settle(page, check);
        const orig = await page.evaluate(() => { const im = [...document.querySelectorAll('img[src*="pinimg.com"]')].sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0]; return im ? { src: im.src, w: im.naturalWidth, h: im.naturalHeight } : null; });
        if (orig && orig.w >= 600) { pick.url = orig.src; pick.w = orig.w; pick.h = orig.h; }
        await page.goBack({ waitUntil: 'domcontentloaded' }); await settle(page, check);
      } catch { /* keep the grid image */ }
    }
    return out;
  },

  async google({ page, query, need, check, state, site }) {
    await visit(page, 'https://www.google.com/search?udm=2&hl=en&q=' + encodeURIComponent(query));
    await settle(page, check); await dismissOverlays(page);
    await wander(page, check, 3);
    // the full-size URLs sit in the page's data as ["https://…", height, width] triples; thumbnails on screen are tiny
    const html = await page.content();
    const out = []; const seen = new Set();
    for (const m of html.matchAll(/\["(https?:\/\/[^"\\]+?)",(\d{3,5}),(\d{3,5})\]/g)) {
      const url = m[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
      if (/gstatic\.com|googleusercontent\.com\/proxy|google\.com\/images/.test(url)) continue;
      const h = Number(m[2]), w = Number(m[3]);
      if (w < 600 || h < 400 || seen.has(url)) continue; seen.add(url);
      out.push({ url, page: 'https://www.google.com/', title: '', w, h });
      if (out.length >= need * 3) break;
    }
    try { const thumbs = page.locator('div[data-ri] img, div[jsname] img').first(); await hoverAt(page, check, thumbs); } catch { /* fine */ }
    state('searching', { site, message: `Google Images: ${out.length} large results for “${query}”` });
    return out;
  },

  async bing({ page, query, need, check, state, site }) {
    await visit(page, 'https://www.bing.com/images/search?q=' + encodeURIComponent(query) + '&form=HDRSC2&first=1');
    await settle(page, check); await dismissOverlays(page);
    const out = []; const seen = new Set();
    for (let round = 0; round < 4 && out.length < need * 3; round++) {
      await wander(page, check, 2);
      const items = await evalSafe(page, () => [...document.querySelectorAll('a.iusc')].map((a) => { try { return JSON.parse(a.getAttribute('m') || '{}'); } catch { return {}; } }));
      for (const it of items) { if (!it.murl || seen.has(it.murl)) continue; seen.add(it.murl); out.push({ url: it.murl, page: it.purl || 'https://www.bing.com/', title: it.t || '', w: null, h: null }); }
      state('searching', { site, message: `Bing Images: ${out.length} results for “${query}”` });
    }
    return out;
  },

  async unsplash({ page, query, need, check, state, site }) {
    await visit(page, 'https://unsplash.com/s/photos/' + encodeURIComponent(query.replace(/\s+/g, '-')));
    await settle(page, check); await wander(page, check, 2);
    const srcs = await evalSafe(page, () => [...document.querySelectorAll('img[src*="images.unsplash.com/photo-"]')].map((i) => ({ src: i.src, alt: i.alt || '' })));
    const out = []; const seen = new Set();
    for (const s of srcs) { const base = s.src.split('?')[0]; if (seen.has(base)) continue; seen.add(base); out.push({ url: base + '?w=1400&q=80&fm=jpg', page: 'https://unsplash.com/', title: s.alt, w: null, h: null }); }
    state('searching', { site, message: `Unsplash: ${out.length} photos for “${query}”` });
    return out;
  },

  async pexels({ page, query, need, check, state, site }) {
    await visit(page, 'https://www.pexels.com/search/' + encodeURIComponent(query) + '/');
    await settle(page, check); await wander(page, check, 2);
    // only the result cards (<article>): the "related search" pills carry 40 px thumbnails of unrelated photos (a
    // black t-shirt, a black car) and the Canva "create your own" strip carries AI images; neither is a reference
    const srcs = await evalSafe(page, () => [...document.querySelectorAll('article img[src*="images.pexels.com/photos/"]')].filter((i) => i.getBoundingClientRect().width > 150 && !/aigc-bundle/.test(i.src)).map((i) => ({ src: i.src, alt: (i.alt || '').replace(/^Free\s+/i, '') })));
    const out = []; const seen = new Set();
    for (const s of srcs) { const base = s.src.split('?')[0]; if (seen.has(base)) continue; seen.add(base); out.push({ url: base + '?auto=compress&cs=tinysrgb&w=1400', page: 'https://www.pexels.com/', title: s.alt, w: null, h: null }); }
    state('searching', { site, message: `Pexels: ${out.length} photos for “${query}”` });
    return out;
  },
};

// ---------------------------------------------------------------- download
export async function downloadImage(url, outDir, n, referer) {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
    // no avif in the accept list: CDNs (Pexels) would serve AVIF, which the pipeline's image tools do not read
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'image/jpeg,image/png,image/webp,image/*;q=0.9,*/*;q=0.8', referer: referer || '' }, signal: ctl.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = IMG_EXT[type]; if (!ext) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) return null;
    const file = path.join(outDir, `ref-${String(n).padStart(2, '0')}-${crypto.createHash('md5').update(url).digest('hex').slice(0, 6)}${ext}`);
    fs.writeFileSync(file, buf);
    return { file, bytes: buf.length, type };
  } catch { return null; }
}
