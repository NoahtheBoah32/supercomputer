// Claude account gate + ElevenLabs key checks. Nothing here ever prints a key.
import { spawn } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isWin = process.platform === 'win32';
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The Claude Code binary. The Agent SDK ships one per platform, so a packaged install needs no npm and no global
// `claude`; that one is preferred, `claude` on PATH is the fallback. SUPACOMPUTA_CLAUDE overrides both.
const BUNDLED = path.join(APP_ROOT, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, isWin ? 'claude.exe' : 'claude');
export const CLAUDE_BIN = process.env.SUPACOMPUTA_CLAUDE || (fs.existsSync(BUNDLED) ? BUNDLED : 'claude');
const viaShell = isWin && !path.isAbsolute(CLAUDE_BIN);   // `claude` on PATH is a .cmd shim and needs cmd.exe

function run(cmd, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { shell: cmd === CLAUDE_BIN ? viaShell : isWin, windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { try { p.kill(); } catch {} resolve({ code: -1, out, err: err + '\ntimeout' }); }, timeoutMs);
    p.stdout.on('data', (d) => out += d);
    p.stderr.on('data', (d) => err += d);
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e) }); });
  });
}

// `claude auth status` prints JSON: { loggedIn, authMethod, email, subscriptionType, ... }
export async function claudeStatus() {
  const r = await run(CLAUDE_BIN, ['auth', 'status']);
  const m = r.out.match(/\{[\s\S]*\}/);
  if (!m) return { installed: r.code !== -1 && !/not recognized|not found/i.test(r.err), loggedIn: false, raw: (r.err || r.out).slice(0, 300) };
  try {
    const j = JSON.parse(m[0]);
    return {
      installed: true,
      loggedIn: Boolean(j.loggedIn),
      email: j.email || '',
      subscription: j.subscriptionType || '',
      authMethod: j.authMethod || '',
    };
  } catch {
    return { installed: true, loggedIn: false, raw: r.out.slice(0, 300) };
  }
}

export async function claudeVersion() {
  const r = await run(CLAUDE_BIN, ['--version']);
  return (r.out || r.err).trim().slice(0, 80);
}

// Opens a real terminal window for the OAuth login. The browser page never sees credentials.
export function openClaudeLogin() {
  const bin = path.isAbsolute(CLAUDE_BIN) ? `"${CLAUDE_BIN}"` : CLAUDE_BIN;
  if (isWin) {
    // one verbatim command line: cmd strips the outer quotes of the /k argument and runs "<path>\claude.exe" auth login
    spawn('cmd', ['/c', `start "Claude login" cmd /k "${bin} auth login"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } else if (process.platform === 'darwin') {
    spawn('osascript', ['-e', `tell application "Terminal" to do script "${bin.replace(/"/g, '\\"')} auth login"`], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('x-terminal-emulator', ['-e', `${bin} auth login`], { detached: true, stdio: 'ignore' }).unref();
  }
}

// GET /v1/user/subscription with the key. Free call. Returns plan + credit counters, never the key.
export function elevenLabsCheck(key) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.elevenlabs.io', path: '/v1/user/subscription', method: 'GET',
      headers: { 'xi-api-key': key, 'accept': 'application/json' }, timeout: 15000,
    }, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve({ ok: false, status: res.statusCode, error: body.slice(0, 200) });
        try {
          const j = JSON.parse(body);
          resolve({ ok: true, tier: j.tier, used: j.character_count, limit: j.character_limit, resetUnix: j.next_character_count_reset_unix });
        } catch { resolve({ ok: false, status: res.statusCode, error: 'bad json' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
    req.end();
  });
}

// ---------- Higgsfield and fal key checks ----------
// Both are free read-only calls documented by the providers (docs.higgsfield.ai, fal.ai/docs). Result shape matches
// elevenLabsCheck: { ok, status?, error? } plus whatever balance info the provider exposes. Keys are never logged.
function jsonRequest(opts, body) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { accept: 'application/json', 'user-agent': 'Supacomputah/1.0', ...(opts.headers || {}) }; // Cloudflare on api.higgsfield.ai bans anonymous client signatures
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = data.length; }
    const mod = opts.protocol === 'http:' ? http : https; // http only for a local stand-in server in tests (PIAPI_BASE)
    const req = mod.request({ method: 'GET', timeout: 15000, ...opts, headers }, (res) => {
      let txt = ''; res.on('data', (d) => txt += d);
      res.on('end', () => { let j = null; try { j = JSON.parse(txt); } catch { /* not json */ } resolve({ status: res.statusCode, body: j, text: txt.slice(0, 300) }); });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, error: String(e.message || e) }));
    if (data) req.write(data);
    req.end();
  });
}
// Higgsfield keys are a "KEY_ID:KEY_SECRET" pair. POST /estimate/<model> costs nothing, needs valid auth, and returns
// the credit price of one render, which doubles as a "this key works" signal.
export async function higgsfieldCheck(key) {
  const r = await jsonRequest({ hostname: 'api.higgsfield.ai', path: '/estimate/higgsfield-ai/soul/v2/standard', method: 'POST', headers: { authorization: `Key ${key}` } }, { prompt: 'key check' });
  if (r.status === 200) return { ok: true, perImage: r.body?.credits ? Number(r.body.credits) : null, perImageUsd: r.body?.usd ? Number(r.body.usd) : null };
  if (r.status === 401 || r.status === 403) return { ok: false, status: r.status, error: r.body?.detail || 'rejected' };
  if (r.status === 0) return { ok: false, status: 0, error: r.error };
  // any other answer means the key was accepted but the estimate shape changed; keep the key, mark it unverified
  return { ok: true, unverified: true, status: r.status };
}
// fal: GET /v1/models/pricing is free, needs a valid key (401 otherwise). Balance needs an ADMIN-scope key; we try and
// ignore a 403 so an API-scope key still verifies.
export async function falCheck(key) {
  const r = await jsonRequest({ hostname: 'api.fal.ai', path: '/v1/models/pricing?endpoint_id=fal-ai/gpt-image-1.5', headers: { authorization: `Key ${key}` } });
  if (r.status === 401 || r.status === 403) return { ok: false, status: r.status, error: r.body?.detail || r.body?.message || 'rejected' };
  if (r.status === 0) return { ok: false, status: 0, error: r.error };
  const out = { ok: true, unverified: r.status !== 200 };
  const price = r.body?.prices?.[0]; if (price) { out.perImageUsd = price.unit_price; out.unit = price.unit; }
  const b = await jsonRequest({ hostname: 'api.fal.ai', path: '/v1/account/billing?expand=credits', headers: { authorization: `Key ${key}` } });
  if (b.status === 200 && b.body?.credits) { out.balance = b.body.credits.current_balance; out.currency = b.body.credits.currency || 'USD'; }
  return out;
}
// PiAPI (Seedance 2.5 video): GET /account/info is free, needs a valid key (401 otherwise) and reports the balance in
// USD (equivalent_in_usd). PIAPI_BASE overrides the host for tests, the same way tools/gen_video.py honours it.
export const PIAPI_PER_SECOND = { '480p': 0.15, '720p': 0.35, '1080p': 0.80 };
export async function piapiCheck(key) {
  let target = { hostname: 'api.piapi.ai' };
  if (process.env.PIAPI_BASE) { try { const u = new URL(process.env.PIAPI_BASE); target = { hostname: u.hostname, port: u.port ? Number(u.port) : undefined, protocol: u.protocol }; } catch { /* keep default */ } }
  const r = await jsonRequest({ ...target, path: '/account/info', headers: { 'x-api-key': key } });
  if (r.status === 401 || r.status === 403) return { ok: false, status: r.status, error: r.body?.message || r.body?.detail || 'rejected' };
  if (r.status === 0) return { ok: false, status: 0, error: r.error };
  const out = { ok: true, unverified: r.status !== 200, currency: 'USD', perSecond: PIAPI_PER_SECOND };
  const d = r.body && typeof r.body.data === 'object' && r.body.data ? r.body.data : (r.body || {});
  for (const k of ['equivalent_in_usd', 'balance_usd', 'balance', 'credits', 'remaining_credits']) {
    const v = d[k]; const n = typeof v === 'string' ? Number(v.replace(/[$,]/g, '')) : v;
    if (Number.isFinite(n)) { out.balance = n; out.balanceField = k; break; }
  }
  if (d.plan || d.plan_name) out.plan = String(d.plan || d.plan_name);
  return out;
}
export function providerCheck(provider, key) {
  if (provider === 'elevenlabs') return elevenLabsCheck(key);
  if (provider === 'higgsfield') return higgsfieldCheck(key);
  if (provider === 'fal') return falCheck(key);
  if (provider === 'piapi') return piapiCheck(key);
  return Promise.resolve({ ok: false, error: 'unknown provider' });
}
