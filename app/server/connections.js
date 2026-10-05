// Connections: programs on this machine the agent can drive. Blender first.
// A connection is detected by scanning the usual install folders (and PATH), verified by running `--version`,
// and stored in config.json as { connections: { blender: { path, version, connectedAt } } }.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { readConfig, writeConfig } from './config.js';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

export const PROGRAMS = {
  blender: {
    name: 'Blender',
    tagline: 'Motion previz: the agent builds the camera move in Blender and renders a low-poly reference clip on this machine.',
    exe: IS_WIN ? 'blender.exe' : IS_MAC ? 'Blender' : 'blender',
    url: 'https://www.blender.org/download/',
  },
};

// --- where Blender usually lives ----------------------------------------------------------------
function blenderCandidates() {
  const out = [];
  const add = (p) => { if (p && !out.includes(p)) out.push(p); };
  if (process.env.BLENDER_PATH) add(process.env.BLENDER_PATH);
  if (IS_WIN) {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(os.homedir(), 'AppData', 'Local', 'Programs')].filter(Boolean)) {
      const bf = path.join(root, 'Blender Foundation');
      if (fs.existsSync(bf)) for (const d of fs.readdirSync(bf).sort().reverse()) add(path.join(bf, d, 'blender.exe'));
    }
    // Steam
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) add(path.join(root, 'Steam', 'steamapps', 'common', 'Blender', 'blender.exe'));
    // Microsoft Store / winget portable installs end up on PATH; `where` covers those below
  } else if (IS_MAC) {
    add('/Applications/Blender.app/Contents/MacOS/Blender');
    add(path.join(os.homedir(), 'Applications', 'Blender.app', 'Contents', 'MacOS', 'Blender'));
    const apps = '/Applications';
    if (fs.existsSync(apps)) for (const d of fs.readdirSync(apps)) if (/^Blender.*\.app$/i.test(d)) add(path.join(apps, d, 'Contents', 'MacOS', 'Blender'));
  } else {
    for (const p of ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender', '/opt/blender/blender']) add(p);
  }
  return out;
}

function onPath(cmd) {
  return new Promise((resolve) => {
    execFile(IS_WIN ? 'where' : 'which', [cmd], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(String(stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    });
  });
}

export function blenderVersion(exe) {
  return new Promise((resolve) => {
    if (!exe || !fs.existsSync(exe)) return resolve(null);
    // Only ever launch something named Blender: a stray path (notepad.exe) must not get started with --version.
    if (!/^blender(\.exe)?$/i.test(path.basename(exe))) return resolve(null);
    execFile(exe, ['--version'], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      const m = String(stdout || '').match(/Blender\s+(\d+\.\d+(?:\.\d+)?)/);
      resolve(m ? m[1] : null);      // no version line = not Blender, whatever the exit code
    });
  });
}

// Scan the machine: every candidate that answers `--version`, newest first.
export async function scanBlender() {
  const cands = blenderCandidates().concat(await onPath(IS_WIN ? 'blender.exe' : 'blender'));
  const found = [];
  for (const p of cands) {
    if (found.some((f) => f.path.toLowerCase() === p.toLowerCase())) continue;
    const version = await blenderVersion(p);
    if (version) found.push({ path: p, version });
  }
  found.sort((a, b) => cmpVer(b.version, a.version));
  return found;
}
function cmpVer(a, b) { const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; } return 0; }

export function connections(cfg = readConfig()) {
  const c = cfg.connections || {};
  return Object.fromEntries(Object.entries(PROGRAMS).map(([k, p]) => [k, { key: k, name: p.name, tagline: p.tagline, url: p.url, connected: Boolean(c[k]?.path), path: c[k]?.path || '', version: c[k]?.version || '', connectedAt: c[k]?.connectedAt || 0 }]));
}

export async function connect(key, wantPath) {
  if (!PROGRAMS[key]) throw new Error('unknown program');
  let hit = null;
  if (wantPath) { const version = await blenderVersion(wantPath); if (!version) throw new Error('That file does not answer as Blender. Pick blender.exe (Windows) or Blender.app/Contents/MacOS/Blender (Mac).'); hit = { path: wantPath, version }; }
  else { const all = await scanBlender(); if (!all.length) throw new Error('Blender was not found on this machine. Install it from blender.org, or point me at the file.'); hit = all[0]; }
  const cfg = readConfig(); const cur = cfg.connections || {};
  writeConfig({ connections: { ...cur, [key]: { path: hit.path, version: hit.version, connectedAt: Date.now() } } });
  return connections()[key];
}

export function disconnect(key) {
  const cfg = readConfig(); const cur = { ...(cfg.connections || {}) }; delete cur[key];
  writeConfig({ connections: cur });
  return connections()[key];
}

// what the agent's environment needs
export function connectionEnv(cfg = readConfig()) {
  const b = cfg.connections?.blender;
  return b?.path ? { BLENDER_PATH: b.path } : {};
}
