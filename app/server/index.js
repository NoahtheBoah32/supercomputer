// SupaComputa local server: static UI + REST + WebSocket streaming. Binds to 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';
import { APP_ROOT, PIPELINE_ROOT, UPLOADS_DIR, readConfig, writeConfig, publicConfig, PROVIDERS, IMAGE_PROVIDERS, PROVIDER_NAMES } from './config.js';
import { listChats, newChat, loadChat, saveChat, deleteChat } from './store.js';
import { claudeStatus, claudeVersion, openClaudeLogin, providerCheck } from './auth.js';
import { ChatRunner, getModels, spentSince, lastPrice } from './agent.js';
import { connections, connect, disconnect, scanBlender } from './connections.js';
import { BlenderLive } from './blender.js';

const PORT = Number(process.env.SUPACOMPUTA_PORT || 8797);
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(APP_ROOT, 'web'), { extensions: ['html'], etag: false, lastModified: false, setHeaders: (res) => res.set('Cache-Control', 'no-store') })); // local app: always serve the current files

const runners = new Map();   // chatId -> ChatRunner
const sockets = new Set();
function broadcast(ev) { const s = JSON.stringify(ev); for (const ws of sockets) if (ws.readyState === 1) ws.send(s); }
// Events from a chat's agent go to every window; a finished previz also reloads that chat's live Blender, if open.
const blender = new BlenderLive({ emit: broadcast });
function agentEmit(ev) { if (ev.t === 'previz_done' && ev.blend) blender.reload(ev.chatId, ev.blend); broadcast(ev); }
function runnerFor(id) {
  let r = runners.get(id);
  if (!r) { const chat = loadChat(id); if (!chat) return null; r = new ChatRunner(chat, agentEmit); runners.set(id, r); }
  return r;
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { blender.closeAll(); process.exit(0); });
process.on('exit', () => blender.closeAll());

// ---------- status, login, key ----------
app.get('/api/status', async (_req, res) => {
  const [claude, version] = await Promise.all([claudeStatus(), claudeVersion()]);
  res.json({ claude, version, config: publicConfig(), models: getModels(), keysInFile: keysInFile() });
});
app.post('/api/login/open', (_req, res) => { openClaudeLogin(); res.json({ ok: true }); });
// ---------- provider keys ----------
// One stored key per provider (ElevenLabs, Higgsfield, fal). Each is verified with a free read-only call, stored in
// config.json (owner-only) and only ever leaves this process as an environment variable for the pipeline. Nothing here
// echoes a key back to the page.
const KEY_FILE = path.join(path.dirname(path.resolve(PIPELINE_ROOT)), 'API-KEYS.local.md');
const FILE_NAMES = { elevenlabs: ['ELEVENLABS_API_KEY'], higgsfield: ['HIGGSFIELD_API_KEY', 'HF_KEY'], fal: ['FAL_KEY', 'FAL_API_KEY'], piapi: ['PIAPI_API_KEY', 'PIAPI_KEY'] };
function keyFromFile(provider) {
  try {
    for (const line of fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)) {
      for (const n of FILE_NAMES[provider] || []) { const m = line.match(new RegExp('^' + n + '=\\s*(\\S+)')); if (m) return m[1].trim(); }
    }
  } catch { /* none */ }
  return '';
}
function keysInFile() { return Object.fromEntries(PROVIDERS.map((p) => [p, Boolean(keyFromFile(p))])); }
function providerOf(req) { const p = String(req.body?.provider || req.query?.provider || 'elevenlabs'); return PROVIDERS.includes(p) ? p : null; }
async function storeKey(provider, key, res, from) {
  const shape = provider === 'higgsfield' ? /^[A-Za-z0-9_\-]{8,}:[A-Za-z0-9_\-]{8,}$/ : /^[A-Za-z0-9_\-:.]{16,}$/;
  if (!shape.test(key)) return res.status(400).json({ ok: false, error: provider === 'higgsfield' ? 'Higgsfield keys are a pair: paste them as KEY_ID:KEY_SECRET.' : `That does not look like a ${PROVIDER_NAMES[provider]} key.` });
  const check = await providerCheck(provider, key);
  if (!check.ok) return res.status(400).json({ ok: false, error: check.status === 401 || check.status === 403 ? `${PROVIDER_NAMES[provider]} rejected the key${from}.` : `Could not verify the key (${check.error || check.status}).` });
  writeConfig({ keys: { [provider]: key } });
  res.json({ ok: true, provider, ...check, name: PROVIDER_NAMES[provider] });
}
app.post('/api/key', async (req, res) => {
  const provider = providerOf(req); if (!provider) return res.status(400).json({ ok: false, error: 'unknown provider' });
  await storeKey(provider, String(req.body?.key || '').trim(), res, '');
});
// Optional: pull a key from the private API-KEYS.local.md the pipeline already reads. Never echoed.
app.post('/api/key/import', async (req, res) => {
  const provider = providerOf(req); if (!provider) return res.status(400).json({ ok: false, error: 'unknown provider' });
  const key = keyFromFile(provider);
  if (!key) return res.status(404).json({ ok: false, error: `No ${FILE_NAMES[provider][0]} line found in API-KEYS.local.md.` });
  await storeKey(provider, key, res, ' in the file');
});
app.delete('/api/key', (req, res) => {
  const provider = providerOf(req); if (!provider) return res.status(400).json({ ok: false, error: 'unknown provider' });
  writeConfig({ keys: { [provider]: '' } }); res.json({ ok: true, provider });
});
// Balance for a provider (default: the configured priority). ElevenLabs exposes credits; fal a USD balance on admin
// keys; Higgsfield only a per-image price.
app.get('/api/credits', async (req, res) => {
  const c = readConfig();
  const provider = PROVIDERS.includes(String(req.query.provider)) ? String(req.query.provider) : c.provider;
  if (!c.keys[provider]) return res.json({ ok: false, provider, name: PROVIDER_NAMES[provider], error: 'no key' });
  const r = await providerCheck(provider, c.keys[provider]);
  if (r.ok) lastPrice[provider] = { perImage: r.perImage || null, perImageUsd: r.perImageUsd || null };
  const out = { ...r, provider, name: PROVIDER_NAMES[provider] };
  if (provider !== 'elevenlabs') {
    // live balance (fal admin keys) wins; otherwise the balance the user typed, counted down by the pipeline's logs
    const man = c.balances[provider];
    const spent = spentSince(provider, man?.at);
    out.spent = spent.amount; out.renders = spent.renders;
    if (out.balance != null) out.live = true;
    if (out.balance == null && man && Number.isFinite(Number(man.start))) { out.start = Number(man.start); out.balance = Math.round((out.start - spent.amount) * 1000) / 1000; out.manual = true; out.since = man.at; }
    out.currency = provider === 'fal' || provider === 'piapi' ? 'USD' : 'credits';
  }
  res.json(out);
});
app.post('/api/settings', (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (typeof b.model === 'string') patch.model = b.model;
  if (['low', 'medium', 'high', 'xhigh', 'max'].includes(b.effort)) patch.effort = b.effort;
  if (['ask', 'auto'].includes(b.mode)) patch.mode = b.mode;
  if (typeof b.name === 'string') patch.name = b.name.slice(0, 40);
  if (IMAGE_PROVIDERS.includes(b.provider)) patch.provider = b.provider; // the image priority; PiAPI is video-only
  if (typeof b.cvAuto === 'boolean') patch.cvAuto = b.cvAuto;
  if (['auto', 'piapi', 'elevenlabs'].includes(b.videoProvider)) patch.videoProvider = b.videoProvider; // which key renders video
  if (b.balances && typeof b.balances === 'object') { // { higgsfield: 120, fal: 25.5, elevenlabs: null } -> set or clear a typed balance
    patch.balances = {};
    for (const p of PROVIDERS) if (p in b.balances) { const v = b.balances[p]; patch.balances[p] = v == null || v === '' ? null : { start: Number(v), at: new Date().toISOString() }; }
  }
  writeConfig(patch);
  res.json(publicConfig());
});
app.get('/api/models', (_req, res) => res.json(getModels()));

// ---------- connections: programs on this machine the agent can drive (Blender first) ----------
app.get('/api/connections', (_req, res) => res.json({ programs: connections(), platform: process.platform }));
app.post('/api/connections/:key/scan', async (req, res) => {
  if (req.params.key !== 'blender') return res.status(404).json({ error: 'unknown program' });
  try { res.json({ found: await scanBlender() }); } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
app.post('/api/connections/:key/connect', async (req, res) => {
  try { res.json(await connect(req.params.key, typeof req.body?.path === 'string' ? req.body.path.trim() : '')); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
app.delete('/api/connections/:key', (req, res) => {
  if (req.params.key === 'blender') blender.closeAll();
  try { res.json(disconnect(req.params.key)); } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
app.get('/api/blender/:chatId', (req, res) => res.json({ open: blender.has(req.params.chatId), ...(blender.info(req.params.chatId) || {}) }));

// ---------- chats ----------
app.get('/api/chats', (_req, res) => res.json(listChats().map((c) => { const r = runners.get(c.id); return { ...c, working: Boolean(r && r.working), needs: r ? r.needs() : null }; })));
app.post('/api/chats', (req, res) => {
  const c = readConfig();
  const chat = newChat({ model: req.body?.model || c.model, effort: req.body?.effort || c.effort, mode: req.body?.mode || c.mode });
  res.json(chat);
});
app.get('/api/chats/:id', (req, res) => {
  const r = runnerFor(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json({ ...r.chat, working: r.working, needs: r.needs(), startedAt: r.startedAt });
});
app.patch('/api/chats/:id', (req, res) => {
  const r = runnerFor(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  if (typeof b.title === 'string' && b.title.trim()) r.chat.title = b.title.trim().slice(0, 80);
  if (typeof b.model === 'string') r.chat.model = b.model;
  if (['low', 'medium', 'high', 'xhigh', 'max'].includes(b.effort)) r.chat.effort = b.effort;
  if (['ask', 'auto'].includes(b.mode)) r.chat.mode = b.mode;
  if (b.alwaysAllowGen === false) r.chat.alwaysAllowGen = false;
  if (b.provider === null || b.provider === '') r.chat.provider = null; else if (PROVIDERS.includes(b.provider)) r.chat.provider = b.provider;
  if (typeof b.pinned === 'boolean') r.chat.pinned = b.pinned;
  saveChat(r.chat);
  res.json(r.chat);
});
app.delete('/api/chats/:id', async (req, res) => {
  scout.close(String(req.params.id)).catch(() => {});
  blender.close(String(req.params.id));
  const r = runners.get(req.params.id);
  if (r) { await r.dispose(); runners.delete(req.params.id); }
  res.json({ ok: deleteChat(req.params.id) });
});

// ---------- files ----------
const MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.txt', '.md', '.csv']);
function allowedPath(p) {
  const abs = path.resolve(p);
  const roots = [PIPELINE_ROOT, UPLOADS_DIR].map((r) => path.resolve(r));
  return roots.some((r) => abs === r || abs.startsWith(r + path.sep)) && MEDIA_EXT.has(path.extname(abs).toLowerCase()) ? abs : null;
}
app.get('/api/file', (req, res) => {
  const abs = allowedPath(String(req.query.p || ''));
  if (!abs || !fs.existsSync(abs)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(abs, { dotfiles: 'allow' }); // uploads live under the .supacomputa dot folder
});
app.post('/api/upload/:chatId', (req, res) => {
  const name = String(req.headers['x-filename'] || 'upload.bin').replace(/[^\w.\-]+/g, '_').slice(0, 120);
  const dir = path.join(UPLOADS_DIR, String(req.params.chatId).replace(/[^0-9a-z-]/gi, '') || 'staging');
  fs.mkdirSync(dir, { recursive: true });
  let target = path.join(dir, name);
  let n = 1;
  while (fs.existsSync(target)) { const e = path.extname(name); target = path.join(dir, `${path.basename(name, e)}-${n++}${e}`); }
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => { fs.writeFileSync(target, Buffer.concat(chunks)); res.json({ path: target, name: path.basename(target) }); });
});

// Job folder listing for the content viewer + home cards.
function scanJob(name) {
  const dir = path.join(PIPELINE_ROOT, 'jobs', name);
  if (!/^[\w-]+$/.test(name) || !fs.existsSync(dir)) return null;
  const media = [];
  const walk = (d, depth) => {
    if (depth > 4) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(png|jpg|jpeg|webp|mp4)$/i.test(e.name)) {
        const rel = path.relative(dir, p).replace(/\\/g, '/');
        const st = fs.statSync(p);
        media.push({ path: p, rel, name: e.name, approved: /approved/.test(e.name), item: rel.split('/').slice(-2, -1)[0] || '', mtime: st.mtimeMs, video: /\.mp4$/i.test(e.name) });
      }
    }
  };
  walk(dir, 0);
  media.sort((a, b) => b.mtime - a.mtime);
  let status = '';
  try { status = fs.readFileSync(path.join(dir, 'STATUS.md'), 'utf8').slice(0, 6000); } catch { /* none */ }
  return { name, dir, media, status };
}
app.get('/api/jobs', (_req, res) => {
  const dir = path.join(PIPELINE_ROOT, 'jobs');
  const out = [];
  if (fs.existsSync(dir)) for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === '__pycache__') continue;
    const j = scanJob(e.name);
    if (j) out.push({ name: j.name, dir: j.dir, count: j.media.length, approved: j.media.filter((m) => m.approved).length, cover: (j.media.find((m) => m.approved && !m.video) || j.media.find((m) => !m.video) || null)?.path || null, mtime: j.media[0]?.mtime || fs.statSync(j.dir).mtimeMs });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  res.json(out);
});
app.get('/api/jobs/:name', (req, res) => { const j = scanJob(req.params.name); if (!j) return res.status(404).json({ error: 'not found' }); res.json(j); });
app.get('/api/skills', (_req, res) => {
  const out = [];
  const fm = (file) => {
    let t = ''; try { t = fs.readFileSync(file, 'utf8').slice(0, 4000); } catch { return {}; }
    const m = t.match(/^---\s*([\s\S]*?)\n---/); const o = {};
    if (m) for (const line of m[1].split('\n')) { const k = line.match(/^(\w+):\s*(.*)$/); if (k) o[k[1]] = k[2].replace(/^["']|["']$/g, ''); }
    if (!o.description) { const d = t.replace(/^---[\s\S]*?\n---/, '').split('\n').map((x) => x.trim()).find((x) => x && !x.startsWith('#')); o.description = (d || '').slice(0, 160); }
    return o;
  };
  const sk = path.join(PIPELINE_ROOT, '.claude', 'skills');
  if (fs.existsSync(sk)) for (const e of fs.readdirSync(sk, { withFileTypes: true })) { if (!e.isDirectory()) continue; const f = path.join(sk, e.name, 'SKILL.md'); if (!fs.existsSync(f)) continue; const o = fm(f); out.push({ kind: 'skill', name: o.name || e.name, description: o.description || '', path: f }); }
  const roles = path.join(PIPELINE_ROOT, 'roles');
  if (fs.existsSync(roles)) for (const f of fs.readdirSync(roles)) { if (!/\.md$/i.test(f) || f.startsWith('_')) continue; const o = fm(path.join(roles, f)); out.push({ kind: 'role', name: f.replace(/\.md$/i, ''), description: o.description || '', path: path.join(roles, f) }); }
  res.json(out);
});
// Upload a skill (.md with a `name:` front matter, or any SKILL.md) or a role (.md/.txt) into the pipeline folder.
app.post('/api/skills/upload', (req, res) => {
  const name = decodeURIComponent(String(req.headers['x-filename'] || 'skill.md')).replace(/[\\/]/g, '_');
  if (!/\.(md|txt)$/i.test(name)) return res.status(400).json({ ok: false, error: 'Skills are Markdown files (.md).' });
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    let text = Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '');
    if (!text.trim()) return res.status(400).json({ ok: false, error: 'That file is empty.' });
    if (text.length > 400000) return res.status(400).json({ ok: false, error: 'That file is too large for a skill.' });
    const fm = text.match(/^---\s*\n([\s\S]*?)\n---/);
    const fmName = fm && (fm[1].match(/^name:\s*(.+)$/m) || [])[1];
    const wanted = String(req.headers['x-kind'] || '');
    const kind = wanted === 'role' || wanted === 'skill' ? wanted : (fmName || /SKILL\.md$/i.test(name)) ? 'skill' : 'role';
    const slug = String(fmName || name.replace(/\.(md|txt)$/i, '').replace(/^SKILL$/i, 'skill')).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'skill';
    let target;
    if (kind === 'skill') {
      if (!fm) { const first = text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || slug; text = `---\nname: ${slug}\ndescription: ${first.slice(0, 160).replace(/["\n]/g, ' ')}\n---\n\n${text}`; }
      const dir = path.join(PIPELINE_ROOT, '.claude', 'skills', slug); fs.mkdirSync(dir, { recursive: true }); target = path.join(dir, 'SKILL.md');
    } else { target = path.join(PIPELINE_ROOT, 'roles', `${slug}.md`); }
    fs.writeFileSync(target, text);
    res.json({ ok: true, kind, name: slug, path: target, replaced: false });
  });
});
app.get('/api/briefs', (_req, res) => {
  const dir = path.join(PIPELINE_ROOT, 'briefs');
  const out = [];
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (/\.(md|txt)$/i.test(f)) out.push({ name: f, path: path.join(dir, f) });
  res.json(out);
});
// Prompt and note files inside the pipeline (.txt / .md): read for the Inspect panel, written back from it.
function textPath(p) {
  const abs = path.resolve(String(p || ''));
  const root = path.resolve(PIPELINE_ROOT);
  if (!(abs === root || abs.startsWith(root + path.sep))) return null;
  if (!/\.(txt|md)$/i.test(abs)) return null;
  return abs;
}
app.get('/api/prompt', (req, res) => {
  const abs = textPath(req.query.path);
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'not a prompt file' });
  res.json({ path: abs, text: fs.readFileSync(abs, 'utf8') });
});
app.post('/api/prompt', (req, res) => {
  const abs = textPath(req.body?.path); const text = req.body?.text;
  if (!abs || typeof text !== 'string') return res.status(400).json({ error: 'path and text required' });
  if (!fs.existsSync(path.dirname(abs))) return res.status(404).json({ error: 'no such folder' });
  if (text.length > 20000) return res.status(413).json({ error: 'too long' });
  fs.writeFileSync(abs, text.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n', 'utf8');
  res.json({ ok: true, path: abs });
});
app.post('/api/open-folder', (req, res) => {
  const p = String(req.body?.path || '');
  const abs = path.resolve(p);
  const ok = [PIPELINE_ROOT, UPLOADS_DIR].some((r) => abs.startsWith(path.resolve(r)));
  if (!ok) return res.status(400).json({ ok: false });
  const isFile = fs.existsSync(abs) && fs.statSync(abs).isFile();
  // open: true opens the file itself with its default app; otherwise reveal its folder
  const target = isFile && !req.body?.open ? path.dirname(abs) : abs;
  const { spawn } = require_child();
  if (process.platform === 'win32') spawn('explorer', [target], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true });
});
import { spawn as _spawn } from 'node:child_process';
import { Scout } from './scout.js';

// ---------------------------------------------------------------- reference scouting (the browser in the side panel)
const scout = new Scout({ emit: broadcast });
function refsDir(r, custom) {
  if (custom) { const abs = path.resolve(path.isAbsolute(custom) ? custom : path.join(PIPELINE_ROOT, custom)); if (abs.startsWith(path.resolve(PIPELINE_ROOT) + path.sep)) return abs; }
  return r.chat.job ? path.join(PIPELINE_ROOT, 'jobs', r.chat.job, 'refs', 'scout') : path.join(PIPELINE_ROOT, 'refs-inbox', r.chat.id.slice(0, 8));
}
// A refs card normally joins the agent's turn (scout_refs.py runs mid-turn). From outside a turn (the app, a test,
// the user picking pictures in the browser) it gets a short turn of its own so the card has a home in the chat.
function pushRefsBlock(r, fields) {
  let ownTurn = null;
  if (!r.turn || !r.working) {
    ownTurn = { id: crypto.randomUUID(), role: 'assistant', ts: Date.now(), status: 'working', blocks: [], durationMs: 0, cost: 0 };
    r.chat.messages.push(ownTurn); r.turn = ownTurn;
    r.emit({ t: 'turn_start', chatId: r.chat.id, turn: { id: ownTurn.id, ts: ownTurn.ts } });
  }
  const block = r.push({ id: crypto.randomUUID(), kind: 'refs', decision: null, ts: Date.now(), ...fields });
  const endOwnTurn = () => { if (!ownTurn) return; ownTurn.status = 'done'; ownTurn.durationMs = Date.now() - ownTurn.ts; if (r.turn === ownTurn) r.turn = null; r.save(); r.emit({ t: 'turn_end', chatId: r.chat.id, turnId: ownTurn.id, status: 'done', durationMs: ownTurn.durationMs, cost: 0 }); ownTurn = null; };
  return { block, endOwnTurn };
}
// The user clicked a picture in the browser panel: save it into an open "your picks" card (made on the first pick).
async function pickRef(r, x, y) {
  const all = r.chat.messages.flatMap((m) => m.role === 'assistant' ? (m.blocks || []) : []);
  let block = all.filter((b) => b.kind === 'refs' && b.picked && b.status === 'open' && (b.items || []).length).pop();
  // look for the picture first: a click that hits nothing must not leave an empty "your picks" set behind
  const item = await scout.pick(r.chat.id, x, y, refsDir(r), (block?.items.length || 0) + 1);
  if (!item) return null;
  let endOwnTurn = null;
  if (!block) { const made = pushRefsBlock(r, { label: 'your picks', query: '', need: 0, items: [], status: 'open', picked: true }); block = made.block; endOwnTurn = made.endOwnTurn; }
  try { r.patch(block, { items: [...block.items, { ...item, keep: true }], status: 'open' }); r.save(); return item; }
  finally { if (endOwnTurn) endOwnTurn(); }
}
// Called by tools/scout_refs.py from inside a chat. Browses, saves, posts a "refs" card to the chat, returns the files.
app.post('/api/scout/run', async (req, res) => {
  const b = req.body || {}; const r = b.chatId ? runnerFor(String(b.chatId)) : null;
  if (!r) return res.status(404).json({ error: 'chat not found' });
  const query = String(b.query || '').trim(); if (!query) return res.status(400).json({ error: 'query required' });
  if (scout.active(r.chat.id)) return res.status(409).json({ error: 'a scout is already running in this chat' });
  const count = Math.max(1, Math.min(10, Number(b.count) || 4));
  const sites = (Array.isArray(b.sites) ? b.sites : ['pinterest', 'pexels', 'google']).map((x) => String(x).toLowerCase()).filter((x) => ['pinterest', 'google', 'bing', 'unsplash', 'pexels'].includes(x));
  // a job named by the caller (jobs/<name> or <name>) puts the refs in that job and binds the chat to it
  const jobName = String(b.job || '').replace(/\\/g, '/').replace(/^jobs\//, '').replace(/\/+$/, '').trim();
  if (jobName && /^[\w.-]+$/.test(jobName) && fs.existsSync(path.join(PIPELINE_ROOT, 'jobs', jobName))) { if (r.chat.job !== jobName) { r.chat.job = jobName; r.save(); broadcast({ t: 'job', chatId: r.chat.id, job: jobName }); } }
  const outDir = refsDir(r, b.out);
  const label = String(b.label || '').slice(0, 80);
  // never show what the user already dropped in this chat
  const dropped = new Set(r.chat.messages.flatMap((m) => m.role === 'assistant' ? m.blocks.filter((x) => x.kind === 'refs') : []).flatMap((x) => (x.items || []).filter((i) => i.keep === false).map((i) => i.url)));
  const exclude = [...dropped, ...(Array.isArray(b.exclude) ? b.exclude : []).map(String)];
  const { block, endOwnTurn } = pushRefsBlock(r, { label, query, need: count, items: [], status: 'searching' });
  try {
    const out = await scout.run({ chatId: r.chat.id, query, count, sites: sites.length ? sites : ['pinterest', 'pexels', 'google'], outDir, exclude, label });
    const items = out.items.map((i) => ({ ...i, keep: true }));
    r.patch(block, { items, status: items.length ? 'open' : 'empty', stopped: out.stopped });
    r.save();
    if (items.length) broadcast({ t: 'refs_request', chatId: r.chat.id, blockId: block.id, label, query, items });
    endOwnTurn();
    res.json({ items, stopped: out.stopped, blockId: block.id });
  } catch (e) {
    r.patch(block, { status: 'error', error: String(e.message || e).slice(0, 200) }); r.save(); endOwnTurn();
    res.status(500).json({ error: String(e.message || e) });
  }
});
app.post('/api/scout/stop', (req, res) => res.json({ ok: scout.stop(String(req.body?.chatId || '')) }));
// Throw a whole "your picks" set away (every file with it). Only a set still under review; a decided one stays.
app.post('/api/refs/dismiss', (req, res) => {
  const b = req.body || {}; const r = b.chatId ? runnerFor(String(b.chatId)) : null;
  if (!r) return res.status(404).json({ error: 'chat not found' });
  const block = r.chat.messages.flatMap((m) => m.role === 'assistant' ? m.blocks : []).find((x) => x.kind === 'refs' && x.id === b.blockId);
  if (!block) return res.status(404).json({ error: 'no such refs card' });
  if (block.status !== 'open' || !block.picked) return res.status(409).json({ error: 'only an open set of your own picks can be removed' });
  const dir = path.resolve(refsDir(r)); const jobs = path.resolve(PIPELINE_ROOT, 'jobs') + path.sep;
  for (const i of block.items || []) { const f = path.resolve(String(i.path || '')); if (f.startsWith(dir + path.sep) || f.startsWith(jobs)) { try { fs.unlinkSync(f); } catch { /* gone */ } } }
  r.patch(block, { items: [], status: 'empty', dismissed: true }); r.save();
  res.json({ ok: true, blockId: block.id });
});
// Take a picture out of an open references set (a pick made by mistake): the file goes too. Only sets still under
// review can lose items; a decided set is what the agent was told, and stays as it was.
app.post('/api/refs/remove', (req, res) => {
  const b = req.body || {}; const r = b.chatId ? runnerFor(String(b.chatId)) : null;
  if (!r) return res.status(404).json({ error: 'chat not found' });
  const block = r.chat.messages.flatMap((m) => m.role === 'assistant' ? m.blocks : []).find((x) => x.kind === 'refs' && x.id === b.blockId);
  if (!block) return res.status(404).json({ error: 'no such refs card' });
  if (block.status !== 'open') return res.status(409).json({ error: 'that set was already sent to the agent' });
  const n = Number(b.n); const item = (block.items || []).find((i) => i.n === n);
  if (!item) return res.status(404).json({ error: 'no such reference' });
  const items = block.items.filter((i) => i.n !== n);
  const dir = path.resolve(refsDir(r)); const f = path.resolve(String(item.path || ''));
  if (f.startsWith(dir + path.sep) || f.startsWith(path.resolve(PIPELINE_ROOT, 'jobs') + path.sep)) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  r.patch(block, { items, status: items.length || !block.picked ? 'open' : 'empty' }); r.save();
  res.json({ ok: true, items, blockId: block.id });
});
// The user's verdict on a refs card: which to keep, whether to keep looking. The client sends the chat message itself.
app.post('/api/refs/decide', (req, res) => {
  const b = req.body || {}; const r = b.chatId ? runnerFor(String(b.chatId)) : null;
  if (!r) return res.status(404).json({ error: 'chat not found' });
  const block = r.chat.messages.flatMap((m) => m.role === 'assistant' ? m.blocks : []).find((x) => x.kind === 'refs' && x.id === b.blockId);
  if (!block) return res.status(404).json({ error: 'no such refs card' });
  const keep = new Set((Array.isArray(b.keep) ? b.keep : []).map(Number));
  const items = (block.items || []).map((i) => ({ ...i, keep: keep.has(i.n) }));
  const decision = b.decision === 'keep' ? 'keep' : 'approve';
  r.patch(block, { items, status: 'decided', decision, decidedAt: Date.now() }); r.save();
  const kept = items.filter((i) => i.keep), dropped = items.filter((i) => !i.keep);
  const line = (i) => `${i.n}. ${i.path}`;
  let text;
  const flags = kept.map((i) => `--ref "${i.path}"`).join(' ');
  if (decision === 'approve') text = `References for ${block.label || block.query}: use ${kept.length ? kept.map((i) => i.n).join(', ') : 'none'}${dropped.length ? `; drop ${dropped.map((i) => i.n).join(', ')}` : ''}.\n${kept.map(line).join('\n')}${kept.length ? `\nAttach them to the render exactly like this: ${flags}` : '\nGenerate without references for this one.'}`;
  else text = `References for ${block.label || block.query}: keep ${kept.length ? kept.map((i) => i.n).join(', ') : 'none'} and find ${dropped.length || block.need} more instead of ${dropped.length ? dropped.map((i) => i.n).join(', ') : 'these'}. Run scout_refs.py again with --count ${dropped.length || block.need}${dropped.length ? ' and --exclude for each dropped file' : ''}; do not show the same pictures again.\n${kept.map(line).join('\n')}${dropped.length ? '\nDropped:\n' + dropped.map(line).join('\n') : ''}`;
  res.json({ ok: true, text, flags, kept, dropped });
});
function require_child() { return { spawn: _spawn }; }

// ---------- websocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
// Each server start is a new build. Clients learn it on connect; one that already runs an older build reloads itself,
// so a restart after a code change never leaves a window on stale page code.
const BUILD = String(Date.now());
wss.on('connection', (ws) => {
  sockets.add(ws);
  try { ws.send(JSON.stringify({ t: 'hello', build: BUILD })); } catch { /* closed already */ }
  ws.on('close', () => sockets.delete(ws));
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const r = msg.chatId ? runnerFor(msg.chatId) : null;
    try {
      switch (msg.t) {
        case 'send': {
          if (!r) return ws.send(JSON.stringify({ t: 'error', error: 'chat not found' }));
          if (r.working) return ws.send(JSON.stringify({ t: 'error', chatId: msg.chatId, error: 'busy' }));
          r.send(String(msg.text || ''), Array.isArray(msg.files) ? msg.files.filter((f) => allowedPath(f)) : [], String(msg.display || '').slice(0, 300)).catch((e) => broadcast({ t: 'error', chatId: msg.chatId, error: String(e.message || e) }));
          return;
        }
        case 'stop': if (r) await r.stop(); return;
        case 'scout_stop': scout.stop(msg.chatId); return;
        // the browser panel: one shared tab per chat
        case 'bro_open': if (r) scout.session(r.chat.id, { width: msg.w, height: msg.h }).then((s) => scout.emitNav(s)).catch((e) => console.error('[browser]', e) || broadcast({ t: 'bro_error', chatId: r.chat.id, message: String(e.message || e).slice(0, 120) })); return;
        case 'bro_close': if (r) scout.close(r.chat.id).catch(() => {}); return;
        case 'bro_resize': if (r) scout.resize(r.chat.id, msg.w, msg.h).catch(() => {}); return;
        case 'bro_nav': if (r) scout.navigate(r.chat.id, msg.url, { width: msg.w, height: msg.h }).catch((e) => { console.error('[browser]', e); broadcast({ t: 'bro_error', chatId: r.chat.id, message: String(e.message || e).slice(0, 120) }); }); return;
        case 'bro_back': if (r) scout.back(r.chat.id); return;
        case 'bro_forward': if (r) scout.forward(r.chat.id); return;
        case 'bro_reload': if (r) scout.reload(r.chat.id); return;
        case 'bro_input': if (r) scout.input(r.chat.id, msg.ev); return;
        // the Blender panel: one live Blender per chat, mirrored and driven from the side panel
        case 'bl_open': if (r) blender.open(r.chat.id, { file: typeof msg.file === 'string' ? msg.file : '', host: msg.host && typeof msg.host === 'object' ? msg.host : null, job: r.chat.job }).catch((e) => { console.error('[blender]', e); broadcast({ t: 'bl_error', chatId: r.chat.id, message: String(e.message || e).slice(0, 160), fatal: true }); }); return;
        case 'bl_close': if (r) blender.close(r.chat.id); return;
        case 'bl_input': if (r) blender.input(r.chat.id, msg.ev); return;
        case 'bl_control': if (r) blender.control(r.chat.id, msg.c); return;
        case 'bl_place': if (r) blender.place(r.chat.id, msg.host); return;
        case 'bl_recast': if (r) blender.recast(r.chat.id, msg.host); return;
        case 'bl_vis': if (r) blender.visible(r.chat.id, Boolean(msg.on)); return;
        case 'bl_popout': return;
        case 'bro_pick': if (r) pickRef(r, Number(msg.x), Number(msg.y)).then((item) => broadcast({ t: 'bro_picked', chatId: r.chat.id, item })).catch((e) => broadcast({ t: 'bro_error', chatId: r.chat.id, message: String(e.message || e).slice(0, 120) })); return;
        case 'answer': if (r) r.answer(msg.requestId, { answers: msg.answers || {}, skip: Boolean(msg.skip) }); return;
        case 'approve': if (r) r.answer(msg.requestId, { decision: msg.decision, prompts: msg.prompts && typeof msg.prompts === 'object' ? msg.prompts : null, params: msg.params && typeof msg.params === 'object' ? msg.params : null }); return;
        case 'ping': ws.send(JSON.stringify({ t: 'pong' })); return;
        default: return;
      }
    } catch (e) { ws.send(JSON.stringify({ t: 'error', chatId: msg.chatId, error: String(e.message || e) })); }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Supercomputer  ${url}`);
  console.log(`pipeline     ${PIPELINE_ROOT}`);
  if (process.argv.includes('--open')) {
    if (process.platform === 'win32') _spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') _spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else _spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
});
server.on('error', (e) => { if (e.code === 'EADDRINUSE') { console.error(`Port ${PORT} is already in use. SupaComputa may already be running: http://127.0.0.1:${PORT}`); process.exit(2); } throw e; });

// Friendly address: also answer on port 80 so http://supacomputa/ (hosts entry) and http://supacomputa.localhost/ work without a port.
// Best effort: if something else owns port 80, the main port still works.
const FRIENDLY_PORT = Number(process.env.SUPACOMPUTA_FRIENDLY_PORT || 80);
if (FRIENDLY_PORT && FRIENDLY_PORT !== PORT) {
  const front = http.createServer(app);
  front.on('upgrade', (req, socket, head) => { if (req.url.split('?')[0] === '/ws') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)); else socket.destroy(); });
  front.on('error', (e) => console.error(`Port ${FRIENDLY_PORT} unavailable (${e.code}); http://supacomputa/ will not resolve, use http://127.0.0.1:${PORT}`));
  front.listen(FRIENDLY_PORT, '127.0.0.1', () => console.log('friendly     http://supacomputah/  (also http://supacomputa/ and http://supacomputah.localhost/)'));
}
