// The Blender panel: one live Blender (GUI) per chat, opened on the chat's newest previz .blend and shown INSIDE the
// app's side panel. Two channels:
//   - the window (Windows): server/blender-cast.ps1 takes Blender's real window, strips its frame, makes it an owned
//     window of the app's Chrome window and keeps it exactly over the panel's Blender area (it follows the app window,
//     hides with it, never shows anywhere else). The user works in the real Blender with the real mouse and keyboard.
//   - the bridge (every platform): server/blender-bridge.py runs inside Blender on a localhost socket for reloading the
//     file the agent just saved, playback, views, and screenshots on a Mac (where the panel shows pictures instead).
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { APP_ROOT, PIPELINE_ROOT, readConfig } from './config.js';

const IS_WIN = process.platform === 'win32';
const BRIDGE = path.join(APP_ROOT, 'server', 'blender-bridge.py');
const CAST = path.join(APP_ROOT, 'server', 'blender-cast.ps1');
const IDLE_MS = 30 * 60 * 1000;

// The newest previz scene of a job (what the panel opens when the chat has one).
export function latestBlend(job) {
  if (!job) return null;
  const dir = path.join(PIPELINE_ROOT, 'jobs', job);
  const out = [];
  const walk = (d, depth) => { let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 3) walk(p, depth + 1); else if (/\.blend$/i.test(e.name)) { try { out.push({ p, m: fs.statSync(p).mtimeMs }); } catch { /* gone */ } } } };
  walk(dir, 0);
  out.sort((a, b) => b.m - a.m);
  return out[0]?.p || null;
}

function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }

// What the page tells us about where the panel is: the page title (finds the app window), the window's screen
// position and sizes, and the panel area, all in CSS px, plus the device pixel ratio. Numbers only.
function cleanHost(h) {
  if (!h || typeof h !== 'object') return null;
  const n = (k, d = 0) => { const v = Number(h[k]); return Number.isFinite(v) ? v : d; };
  const title = String(h.title || 'Supercomputer').slice(0, 120).replace(/[\r\n]/g, ' ');
  const out = { title, dpr: n('dpr', 1) || 1, sx: n('sx'), sy: n('sy'), ow: n('ow'), oh: n('oh'), sw: n('sw'), sh: n('sh'), vw: n('vw'), vh: n('vh'), x: n('x'), y: n('y'), w: n('w'), h: n('h') };
  return out.w > 0 && out.h > 0 ? out : null;
}

export class BlenderLive {
  constructor({ emit }) { this.emit = emit; this.sessions = new Map(); }
  has(chatId) { const s = this.sessions.get(chatId); return Boolean(s && !s.closed); }
  info(chatId) { const s = this.sessions.get(chatId); return s && !s.closed ? { file: s.file, embed: s.embed, state: s.state, version: s.version, placed: s.placed, host: s.host || null, castAlive: Boolean(s.cast), castPid: s.cast ? s.cast.pid : null, recasts: s.recasts || 0, lastError: s.lastError || '' } : null; }
  touch(s) { clearTimeout(s.timer); s.timer = setTimeout(() => this.close(s.chatId), IDLE_MS); }

  exe() { const c = readConfig().connections?.blender; return c?.path && fs.existsSync(c.path) ? c : null; }

  async open(chatId, { file, job, host } = {}) {
    const con = this.exe(); if (!con) throw new Error('Blender is not connected. Connect it under See more > Connections.');
    const want = file && fs.existsSync(file) ? file : latestBlend(job);
    const hostInfo = cleanHost(host);
    const old = this.sessions.get(chatId);
    if (old && !old.closed) {
      if (want && want !== old.file) this.cmd(chatId, { k: 'open', path: want });
      this.touch(old); this.emit({ t: 'bl_open', chatId, file: old.file, embed: old.embed, version: old.version });
      if (hostInfo) { this.place(chatId, hostInfo); this.visible(chatId, true); }
      if (old.lastFrame) this.emit({ t: 'bl_frame', chatId, ...old.lastFrame });
      return old;
    }
    const port = await freePort(); const token = crypto.randomUUID();
    // Blender's first window goes straight where the panel is, so the moment before it is taken over is not a jump.
    let X = 40, Y = 40, W = 1100, H = 720;
    if (hostInfo) {
      const d = hostInfo.dpr; const chromeTop = Math.max(0, hostInfo.oh - hostInfo.vh);
      X = Math.round((hostInfo.sx + hostInfo.x) * d); Y = Math.round((hostInfo.sy + chromeTop + hostInfo.y) * d);
      W = Math.max(400, Math.round(hostInfo.w * d)); H = Math.max(300, Math.round(hostInfo.h * d));
    }
    const args = [];
    if (want) args.push(want);
    args.push('--window-geometry', String(X), String(Y), String(W), String(H), '--python', BRIDGE, '--', '--port', String(port), '--token', token);
    const proc = spawn(con.path, args, { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    const s = { chatId, proc, port, token, file: want || '', w: W, h: H, sock: null, cast: null, embed: IS_WIN, version: con.version, state: null, lastFrame: null, closed: false, timer: null, buf: '', shotTimer: null, host: hostInfo, visible: Boolean(hostInfo), placed: null, hwnd: null };
    this.sessions.set(chatId, s);
    proc.on('exit', () => { if (this.sessions.get(chatId) === s) this.close(chatId, 'Blender closed'); });
    proc.stderr.on('data', (d) => { const t = String(d); if (/Error|Traceback/.test(t)) console.error('[blender]', t.slice(0, 300)); });
    const ready = new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('Blender did not start in time')), 60000);
      proc.stdout.on('data', (d) => { const t = String(d); if (/BRIDGE_READY/.test(t)) { clearTimeout(to); res(); } });
      proc.on('exit', (code) => { clearTimeout(to); rej(new Error(`Blender exited (${code})`)); });
    });
    if (IS_WIN) this.startCast(s);        // takes the window over as soon as it exists, before Blender is even ready
    try { await ready; } catch (e) { this.close(chatId); throw e; }
    await this.connectBridge(s);
    if (!IS_WIN) this.startShots(s);
    this.touch(s);
    this.emit({ t: 'bl_open', chatId, file: s.file, embed: s.embed, version: s.version });
    return s;
  }

  connectBridge(s) {
    return new Promise((resolve) => {
      let tries = 0;
      const attempt = () => {
        const sock = net.createConnection({ host: '127.0.0.1', port: s.port }, () => { sock.write(JSON.stringify({ token: s.token }) + '\n'); });
        sock.setEncoding('utf8');
        sock.on('data', (d) => { s.buf += d; let i; while ((i = s.buf.indexOf('\n')) >= 0) { const line = s.buf.slice(0, i); s.buf = s.buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; } this.onBridge(s, m); } });
        sock.on('error', () => { if (s.closed) return; if (++tries < 40) setTimeout(attempt, 250); else resolve(); });
        sock.on('connect', () => { s.sock = sock; resolve(); });
        sock.on('close', () => { if (s.sock === sock) s.sock = null; });
      };
      attempt();
    });
  }
  onBridge(s, m) {
    if (m.k === 'state') { s.state = m; if (m.file) s.file = m.file; this.emit({ t: 'bl_state', chatId: s.chatId, ...m }); }
    else if (m.k === 'opened') { s.file = m.path; this.emit({ t: 'bl_open', chatId: s.chatId, file: s.file, embed: s.embed, version: s.version }); }
    else if (m.k === 'error') this.emit({ t: 'bl_error', chatId: s.chatId, message: m.message });
    else if (m.k === 'shot' && m.path) { try { const png = fs.readFileSync(m.path).toString('base64'); s.lastFrame = { png, w: s.w, h: s.h }; this.emit({ t: 'bl_frame', chatId: s.chatId, png, w: s.w, h: s.h }); } catch { /* not written yet */ } }
  }
  cmd(chatId, obj) { const s = this.sessions.get(chatId); if (!s || s.closed || !s.sock) return false; this.touch(s); try { s.sock.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; } }

  // ---- Windows: the real window, inside the app
  startCast(s) {
    const cast = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', CAST, '-BlenderPid', String(s.proc.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    s.cast = cast; let buf = '';
    cast.stdout.setEncoding('utf8');
    cast.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (line.startsWith('H ')) { s.hwnd = line.slice(2).trim(); if (s.host) this.castSend(s, { k: 'place', ...s.host }); this.castSend(s, { k: s.visible ? 'show' : 'hide' }); }
        else if (line.startsWith('P ')) { const [, x, y, w, h] = line.split(' ').map(Number); s.placed = { x, y, w, h }; this.emit({ t: 'bl_placed', chatId: s.chatId, x, y, w, h }); }
        else if (line.startsWith('W ')) { const [, hwnd] = line.split(' '); s.hostHwnd = hwnd; }
        else if (line.startsWith('E ')) {
          const msg = line.slice(2);
          if (/window closed/.test(msg)) this.close(s.chatId, 'Blender closed');
          else if (/host closed/.test(msg)) this.close(s.chatId, 'The app window closed, so Blender closed with it');
          else { s.lastError = msg.slice(0, 200); this.emit({ t: 'bl_error', chatId: s.chatId, message: msg }); }
        }
      }
    });
    cast.stderr.on('data', (d) => console.error('[blender-cast]', String(d).slice(0, 300)));
    cast.on('exit', () => { if (s.cast === cast) s.cast = null; });
  }
  castSend(s, obj) { if (!s.cast || !s.cast.stdin.writable) return false; try { s.cast.stdin.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; } }
  // The page saw the window at the wrong size for a while (a lost message, a stalled helper): a fresh helper takes the
  // same Blender window over again and places it from the host the page just sent.
  recast(chatId, host) {
    const s = this.sessions.get(chatId); if (!s || s.closed || !IS_WIN || !s.proc) return false;
    const h = cleanHost(host); if (h) s.host = h;
    s.recasts = (s.recasts || 0) + 1; if (s.recasts > 6) return false;
    const old = s.cast; s.cast = null; if (old) { try { old.kill(); } catch { /* gone */ } }
    s.placed = null; this.startCast(s); return true;
  }
  // The page's panel moved or resized: keep the window on it.
  place(chatId, host) { const s = this.sessions.get(chatId); const h = cleanHost(host); if (!s || s.closed || !h) return false; s.host = h; this.touch(s); return s.cast ? this.castSend(s, { k: 'place', ...h }) : true; }
  // Only while the Blender tab is what the user is looking at.
  visible(chatId, on) { const s = this.sessions.get(chatId); if (!s || s.closed) return false; s.visible = Boolean(on); return s.cast ? this.castSend(s, { k: on ? 'show' : 'hide' }) : true; }

  // ---- Mac/Linux: screenshots through the bridge, a few per second
  startShots(s) {
    const dir = path.join(APP_ROOT, '.cache'); fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `blender-${s.chatId.slice(0, 8)}.png`);
    s.shotTimer = setInterval(() => { if (!s.closed && s.sock) this.cmd(s.chatId, { k: 'shot', path: p }); }, 400);
  }

  // Keys and drags from the panel (the Mac picture; on Windows the real window takes the real input).
  input(chatId, ev) {
    const s = this.sessions.get(chatId); if (!s || s.closed || !ev) return;
    this.touch(s);
    const k = ev.k;
    if (k === 'key') { this.cmd(chatId, { k: 'key', key: String(ev.key || '').toLowerCase(), shift: Boolean(ev.shift), ctrl: Boolean(ev.ctrl) }); return; }
    if (s.embed) return;
    if (k === 'orbit' || k === 'pan') this.cmd(chatId, { k, dx: ev.dx || 0, dy: ev.dy || 0 });
    else if (k === 'wheel') this.cmd(chatId, { k: 'zoom', d: (ev.dy || 0) > 0 ? 1 : -1 });
  }
  // Transport and views from the panel's own controls (the Mac picture) and the agent's reload.
  control(chatId, c) {
    const allowed = ['play', 'pause', 'playtoggle', 'stop', 'frame', 'step', 'jump', 'jumpend', 'view', 'persp', 'shade', 'state', 'open'];
    if (!c || !allowed.includes(c.k)) return false;
    if (c.k === 'open') { const p = String(c.path || ''); if (!p.startsWith(path.resolve(PIPELINE_ROOT)) || !fs.existsSync(p)) return false; }
    return this.cmd(chatId, c);
  }
  // The agent saved a new previz scene: the open Blender loads it.
  reload(chatId, file) { const s = this.sessions.get(chatId); if (!s || s.closed || !file || !fs.existsSync(file)) return false; return this.cmd(chatId, { k: 'open', path: file }); }

  close(chatId, why) {
    const s = this.sessions.get(chatId); if (!s) return false;
    if (s.closed) return false;
    s.closed = true; this.sessions.delete(chatId); clearTimeout(s.timer); clearInterval(s.shotTimer);
    try { this.castSend(s, { k: 'quit' }); } catch { /* gone */ }
    setTimeout(() => { try { s.cast?.kill(); } catch { /* gone */ } }, 500);
    try { s.sock?.destroy(); } catch { /* gone */ }
    try { s.proc.kill(); } catch { /* gone */ }
    this.emit({ t: 'bl_closed', chatId, why: why || '' });
    return true;
  }
  closeAll() { for (const id of [...this.sessions.keys()]) this.close(id); }
}
