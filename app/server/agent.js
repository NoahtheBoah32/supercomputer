// One Claude Agent SDK session per chat, driven over the Leo Workflow pipeline folder.
// Emits UI blocks (text, step, image, question, approval) that the web client renders.
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { APP_ROOT, PIPELINE_ROOT, readConfig, providerFor, videoProviderFor, PROVIDER_ENV, PROVIDER_NAMES } from './config.js';
import { providerCheck } from './auth.js';
import { saveChat } from './store.js';
import { connectionEnv } from './connections.js';

export const STATIC_MODELS = [
  { value: 'default', displayName: 'Auto', description: 'Your Claude Code default model', tag: 'Recommended', cost: 'Included' },
  { value: 'opus[1m]', displayName: 'Claude Opus 5.5', description: 'Best for agentic work and long-running jobs', tag: 'New', cost: 'High cost' },
  { value: 'claude-fable-5-1[1m]', displayName: 'Claude Fable 5.1', description: "Anthropic's most intelligent Claude model", tag: 'New', cost: 'High cost' },
  { value: 'sonnet', displayName: 'Claude Sonnet 5', description: 'Efficient for routine tasks', tag: '', cost: 'Medium cost' },
  { value: 'haiku', displayName: 'Claude Haiku 4.5', description: 'Fastest for quick answers', tag: '', cost: 'Low cost' },
];

let cachedModels = null;
export function getModels() { return cachedModels || STATIC_MODELS; }

function prettyModels(list) {
  const nice = {
    default: { displayName: 'Auto', description: 'Your Claude Code default model', tag: 'Recommended', cost: 'Included' },
  };
  return list
    .filter((m) => /claude|opus|sonnet|haiku|fable|default/i.test(m.value + m.resolvedModel + m.displayName))
    .map((m) => {
      const base = nice[m.value] || {};
      const name = base.displayName || (m.displayName.startsWith('Claude') ? m.displayName : `Claude ${m.displayName}`).replace(/\s*\(.*\)$/, '');
      const cost = /fable|opus/i.test(m.resolvedModel || m.value) ? 'High cost' : /sonnet/i.test(m.resolvedModel || m.value) ? 'Medium cost' : 'Low cost';
      return {
        value: m.value,
        displayName: name,
        description: base.description || m.description.replace(/\s*·\s*/g, ' · '),
        tag: base.tag || (/fable|5\.5|5-5/.test(m.resolvedModel || '') ? 'New' : ''),
        cost: base.cost || cost,
        effortLevels: m.supportedEffortLevels || [],
      };
    });
}

// ---------- tool → step row vocabulary (Higgsfield-style labels) ----------
const REL = (p) => (typeof p === 'string' ? path.relative(PIPELINE_ROOT, p).replace(/\\/g, '/') : '');
const base = (p) => (typeof p === 'string' ? path.basename(p) : '');

// A shell step in plain words. The user sees "Read file · brief.md", never `cd "C:/Users/..." && cat ...`.
const BASE = (p) => String(p || '').replace(/["']/g, '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
function describeCommand(raw) {
  let c = String(raw || '').replace(/\s+/g, ' ').trim();
  // drop leading cd / Set-Location and heredoc bodies; keep the last real command of a chain
  c = c.replace(/^(?:cd|Set-Location|pushd)\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/i, '');
  c = c.replace(/<<\s*['"]?\w+['"]?[\s\S]*$/, '').trim();
  const parts = c.split(/\s*(?:&&|;|\|\|)\s*/).filter((p) => p && !/^(cd|Set-Location|pushd)\b/i.test(p));
  const main = parts[parts.length - 1] || c;
  const words = main.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const w0 = (words[0] || '').replace(/^\.\//, '');
  const arg = (k = 1) => BASE(words[k] || '');
  const firstPath = () => BASE((words.slice(1).find((w) => !/^-/.test(w)) || ''));
  const redirect = main.match(/>{1,2}\s*("[^"]+"|'[^']+'|\S+)/);
  if (redirect) return { icon: 'edit', label: 'Wrote file', sub: BASE(redirect[1]) };
  if (/^python3?$/i.test(w0)) {
    if (words[1] === '-c') return { icon: 'explored', label: 'Ran Python', sub: '' };
    const script = BASE(words[1] || '').replace(/\.py$/, '');
    return { icon: 'explored', label: 'Ran tool', sub: script.replace(/_/g, ' ') };
  }
  if (/^(node|npm|npx)$/i.test(w0)) return { icon: 'explored', label: 'Ran script', sub: BASE(words[1] || '') };
  if (/^(cat|type|head|tail|less|more|Get-Content|gc)$/i.test(w0)) return { icon: 'viewed_skill', label: 'Read file', sub: firstPath() };
  if (/^sed$/i.test(w0) && /-n/.test(main)) return { icon: 'viewed_skill', label: 'Read file', sub: BASE(words[words.length - 1]) };
  if (/^(ls|dir|tree|Get-ChildItem|gci|find|fd)$/i.test(w0)) return { icon: 'explored', label: 'Listed folder', sub: firstPath() };
  if (/^(mkdir|md)$/i.test(w0) || /^New-Item\b.*-ItemType\s+Directory/i.test(main)) return { icon: 'updated_tasks', label: 'Made folder', sub: BASE(words[words.length - 1]) };
  if (/^(touch|New-Item)$/i.test(w0)) return { icon: 'edit', label: 'Created file', sub: BASE(words[words.length - 1]) };
  if (/^(cp|copy|Copy-Item)$/i.test(w0)) return { icon: 'edit', label: 'Copied file', sub: arg(1) };
  if (/^(mv|move|ren|rename|Move-Item|Rename-Item)$/i.test(w0)) return { icon: 'edit', label: 'Moved file', sub: arg(1) };
  if (/^(rm|del|rmdir|Remove-Item|ri)$/i.test(w0)) return { icon: 'edit', label: 'Deleted', sub: BASE(words[words.length - 1]) };
  if (/^(grep|rg|egrep|findstr|Select-String|sls)$/i.test(w0)) {
    // the first alternative of the pattern, without regex punctuation: "ground rules", not "ground rules\|GATE\|^#"
    const pat = (words.find((w, i) => i > 0 && !/^-/.test(w)) || '').replace(/^["']|["']$/g, '');
    const first = pat.split(/\\\||\|/)[0].replace(/[\^$\\()[\]{}*+?.]/g, ' ').replace(/\s+/g, ' ').trim();
    return { icon: 'explored', label: 'Searched files', sub: first.slice(0, 40) };
  }
  if (/^(echo|printf|Write-Output|Write-Host)$/i.test(w0)) return { icon: 'explored', label: 'Printed', sub: '' };
  if (/^(git)$/i.test(w0)) return { icon: 'updated_tasks', label: 'Git', sub: words[1] || '' };
  if (/^(ffmpeg|ffprobe|magick|convert)$/i.test(w0)) return { icon: 'generation', label: 'Processed media', sub: firstPath() };
  if (/^(curl|wget|Invoke-WebRequest|iwr)$/i.test(w0)) return { icon: 'explored', label: 'Fetched', sub: '' };
  if (/^(wc|stat|file|du|Measure-Object|Test-Path)$/i.test(w0)) return { icon: 'explored', label: 'Checked file', sub: firstPath() };
  // only a program name is worth showing; a stray fragment (a sed range, a quoted pattern, a number) is not
  const prog = BASE(w0).replace(/\.(exe|cmd|bat|ps1|sh)$/i, '');
  return { icon: 'explored', label: 'Ran command', sub: /^[A-Za-z][\w.-]{0,39}$/.test(prog) ? prog : '' };
}

function stepFor(name, input) {
  const i = input || {};
  switch (name) {
    case 'Read': {
      const rel = REL(i.file_path);
      if (/^roles\//.test(rel)) return { icon: 'viewed_skill', label: 'Viewed role', sub: base(i.file_path).replace(/\.md$/, '') };
      if (/^libraries\//.test(rel)) return { icon: 'viewed_skill', label: 'Viewed skill', sub: base(i.file_path).replace(/\.md$/, '') };
      if (/^(MAIN|FOLDER-PROTOCOL|PROMPT-STRUCTURES|CLAUDE|README|START-HERE)\.md$/.test(rel)) return { icon: 'viewed_skill', label: 'Viewed manual', sub: rel };
      if (/\.(png|jpg|jpeg|webp)$/i.test(rel)) return { icon: 'explored', label: 'Viewed image', sub: base(i.file_path) };
      if (/\.py$/i.test(rel) && /^jobs\//.test(rel)) return { icon: 'viewed_skill', label: 'Viewed script', sub: base(i.file_path) };
      return { icon: 'viewed_skill', label: 'Viewed file', sub: base(i.file_path) };
    }
    case 'Glob':
    case 'Grep': return { icon: 'explored', label: 'Searched files', sub: String(i.pattern || '').slice(0, 60) };
    case 'Write': return { icon: 'edit', label: 'Wrote file', sub: base(i.file_path) };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': return { icon: 'edit', label: 'Edited file', sub: base(i.file_path) };
    case 'PowerShell':
    case 'Bash': {
      const c = String(i.command || '');
      // A real render has a job and a prompt file and is not a help call. `--help` used to be shown as a Generation, get
      // approved, print usage and be marked Failed: the "first generation always fails" complaint.
      if (/gen_image\.py/.test(c) && /--job\s/.test(c) && /--prompt-file/.test(c) && !/(^|\s)(--help|-h)(\s|$)/.test(c)) {
        const item = (c.match(/--item\s+(\S+)/) || [])[1] || '';
        const v = (c.match(/--version\s+(\d+)/) || [])[1];
        const dry = /--dry-run/.test(c);
        return { icon: 'generation', label: dry ? 'Generation check' : 'Generation', sub: 'Preparing', item, version: v, gen: !dry };
      }
      if (/blender_previz\.py/.test(c) && /--job\s/.test(c) && /--script\s/.test(c) && !/(^|\s)(--help|-h)(\s|$)/.test(c)) {
        const item = (c.match(/--item\s+(\S+)/) || [])[1] || '';
        const v = (c.match(/--version\s+(\d+)/) || [])[1];
        const dry = /--dry-run/.test(c);
        return { icon: 'generation', label: dry ? 'Blender check' : 'Blender render', sub: 'Preparing', item: item ? item + '-previz' : 'previz', version: v, gen: !dry, video: true, previz: true };
      }
      if (/gen_video\.py/.test(c) && /--job\s/.test(c) && /--prompt-file/.test(c) && !/(^|\s)(--help|-h)(\s|$)/.test(c)) {
        const item = (c.match(/--item\s+(\S+)/) || [])[1] || '';
        const v = (c.match(/--version\s+(\d+)/) || [])[1];
        const dry = /--dry-run/.test(c);
        return { icon: 'generation', label: dry ? 'Video check' : 'Video generation', sub: 'Preparing', item: item && /^scene-\d\d$/.test(item) ? item + '-video' : item, version: v, gen: !dry, video: true };
      }
      if (/browser_video\.py\s+submit/.test(c)) {
        const item = (c.match(/--item\s+(\S+)/) || [])[1] || '';
        const v = (c.match(/--version\s+(\d+)/) || [])[1];
        return { icon: 'generation', label: 'Video generation', sub: 'Preparing', item, version: v, gen: true, video: true };
      }
      if (/python[^|;&\n]*new_job\.py/i.test(c)) {   // running it, not grepping for it
        // the job name: `--name x`, else the first plain word after the script (never a flag, a redirect or a pipe)
        const named = (c.match(/--name\s+("[^"]+"|'[^']+'|\S+)/) || [])[1];
        const rest = (c.split(/new_job\.py/)[1] || '').trim().split(/\s+/);
        const plain = rest.find((w) => w && !/^[-|&<>]/.test(w) && !/^\d*[<>]/.test(w) && !/^\//.test(w) && w !== '2>/dev/null') || '';
        return { icon: 'updated_tasks', label: 'Created job', sub: (named || plain).replace(/^["']|["']$/g, '') };
      }
      if (/scout_refs\.py/.test(c)) return { icon: 'explored', label: 'Scouting references', sub: ((c.match(/--for\s+("[^"]+"|'[^']+'|\S+)/) || [])[1] || '').replace(/^["']|["']$/g, '') };
      if (/credits\.py/.test(c)) return { icon: 'usage', label: 'Tallied credits', sub: (c.match(/--scope\s+(\S+)/) || [])[1] || '' };
      if (/browser_video\.py/.test(c)) return { icon: 'explored', label: 'Checked the video workspace', sub: '' };
      return describeCommand(c);
    }
    case 'Agent':
    case 'Task': {
      const role = String(i.description || i.subagent_type || 'agent').slice(0, 60);
      return { icon: 'loaded_skills', label: 'Deployed agent', sub: role, agent: true };
    }
    case 'SendMessage': return { icon: 'loaded_skills', label: 'Messaged agent', sub: String(i.to || '').slice(0, 40) };
    case 'ToolSearch': return { icon: 'loaded_skills', label: 'Loaded tools', sub: String(i.query || '').replace(/^select:/, '').slice(0, 40) };
    case 'WebSearch':
    case 'WebFetch': return { icon: 'explored', label: 'Explored web', sub: String(i.query || i.url || '').slice(0, 50) };
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList': return { icon: 'updated_tasks', label: 'Updated tasks', sub: '' };
    case 'Skill': return { icon: 'loaded_skills', label: 'Loaded skill', sub: String(i.skill || '') };
    case 'AskUserQuestion': return { icon: 'answer', label: 'Asked a question', sub: '' };
    default: return { icon: 'loaded_skills', label: name.replace(/^mcp__\w+__/, '').replace(/_/g, ' '), sub: '' };
  }
}

// The string fields of a JSON object that is still arriving: `{"file_path": "x.py", "content": "import bpy\\n...` gives
// { file_path: { text: 'x.py', done: true }, content: { text: 'import bpy\n...', done: false } }. Escapes are decoded as
// far as they are complete; a value's inner quotes never start a new key because scanning resumes after each value.
export function partialStrings(src) {
  const out = {}; const re = /"([A-Za-z_]\w*)"\s*:\s*"/g; let m;
  const esc = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
  while ((m = re.exec(src))) {
    let j = re.lastIndex, s = '', done = false;
    while (j < src.length) {
      const ch = src[j];
      if (ch === '"') { done = true; j++; break; }
      if (ch === '\\') {
        const n = src[j + 1]; if (n === undefined) break;
        if (n === 'u') { const hex = src.slice(j + 2, j + 6); if (hex.length < 4) break; s += String.fromCharCode(parseInt(hex, 16)); j += 6; continue; }
        s += esc[n] ?? n; j += 2; continue;
      }
      s += ch; j++;
    }
    out[m[1]] = { text: s, done }; re.lastIndex = j;
  }
  return out;
}

// Absolute Windows/posix paths to media inside the pipeline root, found in assistant prose (GATE lines).
const MEDIA_RE = /([A-Za-z]:\\[^\n"'<>|*?]+?\.(?:png|jpg|jpeg|webp|mp4))|(\/[^\n"'<>|*?]+?\.(?:png|jpg|jpeg|webp|mp4))/g;
function mediaPathsIn(text) {
  const out = [];
  const root = path.resolve(PIPELINE_ROOT) + path.sep;
  for (const m of text.matchAll(MEDIA_RE)) {
    const p = (m[1] || m[2]).trim();
    const abs = path.resolve(p);
    // Only pipeline output gets a gate card; an uploaded reference the agent mentions back is not a render.
    if (abs.startsWith(root) && fs.existsSync(abs)) out.push(abs);
  }
  return out;
}

// ElevenLabs credits per generation, learned from the pipeline's own logs: completed runs carry the delta,
// rejected runs carry "N credits are required". Keyed by "aspect res quality", with a "res quality" fallback.
let priceCache = { at: 0, table: {} };
export function priceTable() {
  if (Date.now() - priceCache.at < 30000) return priceCache.table;
  const table = {};
  const jobs = path.join(PIPELINE_ROOT, 'jobs');
  try {
    for (const j of fs.readdirSync(jobs)) {
      const f = path.join(jobs, j, 'log.csv');
      if (!fs.existsSync(f)) continue;
      const rows = fs.readFileSync(f, 'utf8').split(/\r?\n/);
      const head = (rows[0] || '').split(',');
      const iS = head.indexOf('settings'), iC = head.indexOf('credits'), iN = head.indexOf('note'), iSt = head.indexOf('status');
      if (iS < 0) continue;
      for (const r of rows.slice(1)) {
        // naive CSV split is fine for the settings column (no commas before it); the note may contain commas
        const cells = r.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) || [];
        const settings = cells[iS]; if (!settings) continue;
        let credits = 0;
        if (iC >= 0 && /^\d+$/.test(cells[iC] || '') && Number(cells[iC]) > 0 && /completed/.test(cells[iSt] || '')) credits = Number(cells[iC]);
        const req = r.match(/(\d+) credits are required/); if (req) credits = Number(req[1]);
        if (credits) { table[settings] = credits; table[settings.split(' ').slice(1).join(' ')] = credits; }
      }
    }
  } catch { /* no logs yet */ }
  priceCache = { at: Date.now(), table };
  return table;
}
// What the pipeline has spent on a provider since `sinceIso`, read from every job's log.csv (completed rows only).
// Higgsfield logs its own credit estimate in the credits column; fal logs "fal ~$X/image" in the note.
export function spentSince(provider, sinceIso) {
  const model = { higgsfield: 'higgsfield-ai/soul', fal: 'fal-ai/', piapi: 'seedance' }[provider]; if (!model) return { amount: 0, renders: 0 };
  const since = sinceIso ? Date.parse(sinceIso) : 0; let amount = 0, renders = 0;
  const jobs = path.join(PIPELINE_ROOT, 'jobs');
  try {
    for (const j of fs.readdirSync(jobs)) {
      const f = path.join(jobs, j, 'log.csv'); if (!fs.existsSync(f)) continue;
      const rows = fs.readFileSync(f, 'utf8').split(/\r?\n/); const head = (rows[0] || '').split(',');
      const iD = head.indexOf('date'), iT = head.indexOf('time'), iM = head.indexOf('model'), iSt = head.indexOf('status'), iC = head.indexOf('credits'), iN = head.indexOf('note');
      if (iM < 0 || iSt < 0) continue;
      for (const r of rows.slice(1)) {
        const cells = r.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) || [];
        if (!(cells[iM] || '').startsWith(model) || !/completed/.test(cells[iSt] || '')) continue;
        if (since && Date.parse(`${cells[iD]}T${cells[iT]}`) < since) continue;
        renders++;
        if (provider === 'higgsfield') amount += Number(cells[iC]) || 0;
        else { const m = (cells[iN] || '').match(/(?:fal|piapi) ~\$([\d.]+)/); if (m) amount += Number(m[1]); }
      }
    }
  } catch { /* no logs */ }
  return { amount: Math.round(amount * 1000) / 1000, renders };
}
// ---- video (Seedance through PiAPI, tools/gen_video.py) ----
// Mirrors the tool's own table: USD per second of output by resolution, and the duration range per tier.
export const VIDEO_MODELS = {
  'seedance-2.5': { name: 'Seedance 2.5', price: { '480p': 0.15, '720p': 0.35, '1080p': 0.80 }, max: 30 },
  'seedance-2.5-less-restriction': { name: 'Seedance 2.5 · less restriction', price: { '480p': 0.165, '720p': 0.385, '1080p': 0.88 }, max: 30 },
  'seedance-2': { name: 'Seedance 2.0', price: { '480p': 0.10, '720p': 0.20, '1080p': 0.50 }, max: 15 },
  'seedance-2-less-restriction': { name: 'Seedance 2.0 · less restriction', price: { '480p': 0.11, '720p': 0.22, '1080p': 0.55 }, max: 15 },
  'seedance-2-fast': { name: 'Seedance 2.0 Fast', price: { '480p': 0.048, '720p': 0.096 }, max: 15 },
  'seedance-2-fast-less-restriction': { name: 'Seedance 2.0 Fast · less restriction', price: { '480p': 0.053, '720p': 0.106 }, max: 15 },
  'seedance-2-mini': { name: 'Seedance 2.0 Mini', price: { '480p': 0.042, '720p': 0.084 }, max: 15 },
  'seedance-2-mini-less-restriction': { name: 'Seedance 2.0 Mini · less restriction', price: { '480p': 0.046, '720p': 0.092 }, max: 15 },
};
// The same tiers through the ElevenLabs Image & Video API (api.elevenlabs.io/v1/flows/video): billed in ElevenLabs
// credits, which the tool measures from the account counter after each clip; the per-second price is learned from
// the logs (videoCreditTable). Kling is not on that API. Veo takes no reference sheets (frames only) and 4, 6 or 8 s.
export const EL_VIDEO_MODELS = {
  'seedance-2.5': { name: 'Seedance 2.5', id: 'bytedance-seedance-v2.5', res: ['480p', '720p', '1080p'], max: 30, refs: 30 },
  'seedance-2': { name: 'Seedance 2.0', id: 'bytedance-seedance-v2', res: ['480p', '720p', '1080p'], max: 15, refs: 9 },
  'seedance-2-fast': { name: 'Seedance 2.0 Fast', id: 'bytedance-seedance-v2-fast', res: ['480p', '720p'], max: 15, refs: 9 },
  'seedance-2-mini': { name: 'Seedance 2.0 Mini', id: 'bytedance-seedance-v2-mini', res: ['480p', '720p'], max: 15, refs: 9 },
  'veo-3.1': { name: 'Veo 3.1', id: 'veo-3.1-generate-001', res: ['720p', '1080p'], max: 8, fixed: [4, 6, 8], refs: 0 },
  'veo-3.1-fast': { name: 'Veo 3.1 Fast', id: 'veo-3.1-fast-generate-001', res: ['720p', '1080p'], max: 8, fixed: [4, 6, 8], refs: 0 },
};
export const VIDEO_PROVIDER_NAMES = { piapi: 'PiAPI', elevenlabs: 'ElevenLabs' };
// One shape for both catalogs: { name, res: [...], max, usd: {res: $/s} | null }
export function videoCatalog(provider) {
  if (provider === 'elevenlabs') return Object.fromEntries(Object.entries(EL_VIDEO_MODELS).map(([k, m]) => [k, { ...m, usd: null }]));
  return Object.fromEntries(Object.entries(VIDEO_MODELS).map(([k, m]) => [k, { name: m.name, res: Object.keys(m.price), max: m.max, usd: m.price, refs: 9 }]));
}
// ElevenLabs credits per second of video, learned from completed runs in the logs: "<our model> <res>" -> credits/s.
let vcCache = { at: 0, table: {} };
export function videoCreditTable() {
  if (Date.now() - vcCache.at < 30000) return vcCache.table;
  const table = {}; const byId = Object.fromEntries(Object.entries(EL_VIDEO_MODELS).map(([k, m]) => [m.id, k]));
  const jobs = path.join(PIPELINE_ROOT, 'jobs');
  try {
    for (const j of fs.readdirSync(jobs)) {
      const f = path.join(jobs, j, 'log.csv'); if (!fs.existsSync(f)) continue;
      const rows = fs.readFileSync(f, 'utf8').split(/\r?\n/); const head = (rows[0] || '').split(',');
      const iM = head.indexOf('model'), iS = head.indexOf('settings'), iC = head.indexOf('credits'), iSt = head.indexOf('status');
      if (iM < 0 || iS < 0 || iC < 0) continue;
      for (const r of rows.slice(1)) {
        const cells = r.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) || [];
        const ours = byId[cells[iM]]; if (!ours || !/completed/.test(cells[iSt] || '') || !/^\d+$/.test(cells[iC] || '')) continue;
        const m = (cells[iS] || '').match(/(\d+p)\s+(\d+)s/); if (!m) continue;
        const per = Number(cells[iC]) / Number(m[2]); if (per > 0) table[`${ours} ${m[1]}`] = Math.round(per);
      }
    }
  } catch { /* no jobs yet */ }
  vcCache = { at: Date.now(), table }; return table;
}
export const VIDEO_RES = ['480p', '720p', '1080p'];
export const VIDEO_ASPECTS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const RES_ALIAS = { '480p': '480p', sd: '480p', '720p': '720p', hd: '720p', '1080p': '1080p', fhd: '1080p', '1k': '1080p', '2k': '1080p', '1440p': '1080p', '4k': '1080p', '2160p': '1080p', uhd: '1080p' };
// a flag's value stops at shell punctuation too: `--model seedance-2-mini; "EXIT=$?"` names seedance-2-mini, not `seedance-2-mini;`
const FLAG_VAL = `("[^"]+"|'[^']+'|[^\\s;&|)]+)`;
const flagOf = (c, name) => { const m = String(c).match(new RegExp(`(?:^|\\s)${name}\\s+${FLAG_VAL}`)); return m ? m[1].replace(/^["']|["']$/g, '') : ''; };
// What a gen_video.py command will render: the settings, the reference count, the mode and the dollar estimate.
export function videoParams(command, cfg = readConfig()) {
  const c = String(command || '');
  const flagProv = flagOf(c, '--provider'); const provider = VIDEO_PROVIDER_NAMES[flagProv] ? flagProv : (videoProviderFor(cfg) || 'piapi');
  const cat = videoCatalog(provider);
  const modelRaw = flagOf(c, '--model') || 'seedance-2.5'; const model = cat[modelRaw] ? modelRaw : 'seedance-2.5';
  const asked = (flagOf(c, '--resolution') || '1080p').toLowerCase();
  let resolution = RES_ALIAS[asked] || '1080p';
  while (!cat[model].res.includes(resolution) && VIDEO_RES.indexOf(resolution) > 0) resolution = VIDEO_RES[VIDEO_RES.indexOf(resolution) - 1];
  if (!cat[model].res.includes(resolution)) resolution = cat[model].res[0];
  let duration = Math.max(4, Math.min(cat[model].max, Number(flagOf(c, '--duration')) || 6));
  if (cat[model].fixed && !cat[model].fixed.includes(duration)) duration = cat[model].fixed.reduce((a, b) => Math.abs(b - duration) < Math.abs(a - duration) ? b : a);
  const aspectRaw = (flagOf(c, '--aspect') || '16:9').toLowerCase(); const aspect = VIDEO_ASPECTS.includes(aspectRaw) ? aspectRaw : (/^(adaptive|auto)$/.test(aspectRaw) ? 'adaptive' : '16:9');
  const audio = (flagOf(c, '--audio') || 'on') !== 'off';
  const frames = Number(/--start-frame\s/.test(c)) + Number(/--end-frame\s/.test(c));
  let refs = (c.match(/(?:^|\s)--ref\s/g) || []).length;
  const refsFile = flagOf(c, '--refs-file');
  if (refsFile) { try { const abs = path.isAbsolute(refsFile) ? refsFile : path.join(PIPELINE_ROOT, refsFile); const alt = path.join(PIPELINE_ROOT, flagOf(c, '--job') || '', refsFile); const f = fs.existsSync(abs) ? abs : alt; refs += fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => /^@[\w-]+\s+\S/.test(l.trim())).length; } catch { /* file written later */ } }
  const mode = frames ? 'first_last_frames' : refs ? 'omni_reference' : 'text_to_video';
  const usd = cat[model].usd ? Math.round(cat[model].usd[resolution] * duration * 1000) / 1000 : null;
  const creditTable = provider === 'elevenlabs' ? videoCreditTable() : {};
  const perSec = creditTable[`${model} ${resolution}`]; const credits = perSec ? perSec * duration : null;
  return { provider, providerName: VIDEO_PROVIDER_NAMES[provider], model, modelName: cat[model].name, resolution, asked, capped: RES_ALIAS[asked] !== asked && !VIDEO_RES.includes(asked), duration, aspect, audio, refs, frames, mode, usd, credits, creditTable };
}
// The user changed the settings in the approval panel: rewrite the command's flags (only the known ones, validated).
export function applyVideoParams(command, want, cfg = readConfig()) {
  let c = String(command || ''); const w = want && typeof want === 'object' ? want : {};
  const set = (flag, value) => { const re = new RegExp(`((?:^|\\s)${flag})\\s+${FLAG_VAL}`); c = re.test(c) ? c.replace(re, `$1 ${value}`) : `${c} ${flag} ${value}`; };
  const flagProv = flagOf(c, '--provider'); const cat = videoCatalog(VIDEO_PROVIDER_NAMES[flagProv] ? flagProv : (videoProviderFor(cfg) || 'piapi'));
  if (w.model && cat[w.model]) set('--model', w.model);
  const model = cat[flagOf(c, '--model')] ? flagOf(c, '--model') : 'seedance-2.5';
  if (w.resolution && VIDEO_RES.includes(String(w.resolution)) && cat[model]?.res.includes(w.resolution)) set('--resolution', w.resolution);
  if (w.duration != null && Number.isInteger(Number(w.duration)) && Number(w.duration) >= 4 && Number(w.duration) <= (cat[model]?.max || 30) && (!cat[model]?.fixed || cat[model].fixed.includes(Number(w.duration)))) set('--duration', String(Number(w.duration)));
  if (w.aspect && (VIDEO_ASPECTS.includes(String(w.aspect)) || (String(w.aspect) === 'adaptive' && /--start-frame\s/.test(c)))) set('--aspect', w.aspect);
  if (w.audio === 'on' || w.audio === 'off' || typeof w.audio === 'boolean') set('--audio', w.audio === true || w.audio === 'on' ? 'on' : 'off');
  return c;
}
// ---- motion previz (Blender on this machine, tools/blender_previz.py): no credits, settings only ----
export const PREVIZ_RES = ['720p', '1080p', '1440p', '4k'];
export const PREVIZ_FPS = [24, 25, 30, 60];
export const PREVIZ_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '21:9'];
export function previzParams(command, cfg = readConfig()) {
  const c = String(command || '');
  const resRaw = (flagOf(c, '--resolution') || '1080p').toLowerCase();
  const resolution = PREVIZ_RES.includes(resRaw) ? resRaw : resRaw === '2k' ? '1440p' : '1080p';
  const fpsRaw = Number(flagOf(c, '--fps')) || 24; const fps = PREVIZ_FPS.includes(fpsRaw) ? fpsRaw : 24;
  const secRaw = flagOf(c, '--seconds'); const seconds = secRaw && Number(secRaw) > 0 ? Number(secRaw) : null;
  const engine = flagOf(c, '--engine') === 'workbench' ? 'workbench' : 'eevee';
  const aspectRaw = flagOf(c, '--aspect') || '16:9'; const aspect = PREVIZ_ASPECTS.includes(aspectRaw) ? aspectRaw : '16:9';
  const b = cfg.connections?.blender || {};
  return { provider: 'blender', providerName: 'Blender', model: 'blender', modelName: `Blender ${b.version || ''}`.trim(), version: b.version || '', resolution, fps, seconds, duration: seconds, engine, aspect, script: flagOf(c, '--script'), usd: null, credits: null, previz: true, local: true };
}
// The render command runs alone: the app reads its stdout to make the card. Anything the agent chained after it
// (2>&1 | tail -60, > file, ; echo) is dropped, so the flags the approval panel adds land on the script, not on tail.
export function previzCommandOnly(command) {
  const c = String(command || '');
  const at = c.search(/blender_previz\.py/); if (at < 0) return c.trim();
  const m = c.slice(at).match(/\s+(2>&1|2>|&&|\|\||[|;>])/);
  return (m ? c.slice(0, at + m.index) : c).trim();
}
export function applyPrevizParams(command, want) {
  let c = previzCommandOnly(command); const w = want && typeof want === 'object' ? want : {};
  const set = (flag, value) => { const re = new RegExp(`((?:^|\\s)${flag})\\s+${FLAG_VAL}`); c = re.test(c) ? c.replace(re, `$1 ${value}`) : `${c} ${flag} ${value}`; };
  if (w.resolution && PREVIZ_RES.includes(String(w.resolution))) set('--resolution', w.resolution);
  if (w.fps && PREVIZ_FPS.includes(Number(w.fps))) set('--fps', String(Number(w.fps)));
  if (w.seconds === '' || w.seconds === null) c = c.replace(new RegExp(`(?:^|\\s)--seconds\\s+${FLAG_VAL}`), '');
  else if (w.seconds != null && Number(w.seconds) >= 1 && Number(w.seconds) <= 120) set('--seconds', String(Number(w.seconds)));
  if (w.engine === 'eevee' || w.engine === 'workbench') set('--engine', w.engine);
  if (w.aspect && PREVIZ_ASPECTS.includes(String(w.aspect))) set('--aspect', w.aspect);
  return c;
}
// Where a previz command's files land: the script (relative to the job or the root), the preview frame, the scene.
export function previzFiles(command) {
  const c = String(command || ''); const job = flagOf(c, '--job'); const item = flagOf(c, '--item'); const v = flagOf(c, '--version'); const script = flagOf(c, '--script');
  if (!job || !item || !v) return null;
  const jobDir = path.resolve(PIPELINE_ROOT, job);
  const dir = /^scene-\d\d$/.test(item) ? path.join(jobDir, 'scenes', item) : path.join(jobDir, 'previz', item);
  const stem = path.join(dir, `previz-v${v}`);
  const scriptAbs = script ? (path.isAbsolute(script) ? script : (fs.existsSync(path.join(jobDir, script)) ? path.join(jobDir, script) : path.resolve(PIPELINE_ROOT, script))) : stem + '.py';
  return { job, item, version: v, dir, script: scriptAbs, preview: stem + '.preview.png', mp4: stem + '.mp4', blend: stem + '.blend', log: stem + '.run.log' };
}

// The last verified per-render price per provider (filled by /api/credits and key checks), so approval rows can show it.
export const lastPrice = {};
export function usdFor(provider) { return provider === 'fal' ? (lastPrice.fal?.perImageUsd || null) : null; }
export function creditsFor(command, provider) {
  if (provider === 'higgsfield') return lastPrice.higgsfield?.perImage || null;
  if (provider === 'fal') return null; // priced in USD: see usdFor
  if (provider && provider !== 'elevenlabs') return null;
  const c = String(command || '');
  const aspect = (c.match(/--aspect\s+([^\s;&|)]+)/) || [])[1] || '16:9';
  const res = (c.match(/--res\s+([^\s;&|)]+)/) || [])[1] || '1K';
  const quality = (c.match(/--quality\s+([^\s;&|)]+)/) || [])[1] || 'high';
  const t = priceTable();
  return t[`${aspect} ${res} ${quality}`] || t[`${res} ${quality}`] || null;
}

function labelForMedia(p) {
  const rel = REL(p);
  const m = rel.match(/^jobs\/([^/]+)\/(?:sheets\/([^/]+)\/(v\d+|approved)|scenes\/(scene-\d+)\/([\w-]+?)(?:-(v\d+|approved))?)\.(png|jpg|jpeg|webp|mp4)$/);
  if (!m) return { job: (rel.match(/^jobs\/([^/]+)/) || [])[1] || null, item: base(p), version: '' };
  if (m[2]) return { job: m[1], item: m[2], version: m[3] };
  return { job: m[1], item: `${m[4]} ${m[5]}`, version: m[6] || '' };
}

// Roles and project skills the pipeline can load (the same list the Skills page shows).
export function listCustomSkills() {
  const out = [];
  try {
    const sk = path.join(PIPELINE_ROOT, '.claude', 'skills');
    if (fs.existsSync(sk)) for (const e of fs.readdirSync(sk, { withFileTypes: true })) { if (!e.isDirectory()) continue; const f = path.join(sk, e.name, 'SKILL.md'); if (fs.existsSync(f)) out.push({ name: e.name, kind: 'skill', path: f }); }
    const roles = path.join(PIPELINE_ROOT, 'roles');
    if (fs.existsSync(roles)) for (const f of fs.readdirSync(roles)) if (/\.md$/i.test(f) && !f.startsWith('_')) out.push({ name: f.replace(/\.md$/i, ''), kind: 'role', path: path.join(roles, f) });
  } catch { /* none */ }
  return out;
}

// A packaged install carries its own Node and Python under <install>/runtime; put them first on the PATH the agent's
// shell sees so `python tools/gen_image.py` runs the bundled interpreter (and not, on a fresh Windows, the Store stub).
// Windows: runtime/node, runtime/python. Mac: runtime/darwin-<arch>/node/bin, runtime/darwin-<arch>/python/bin.
const RUNTIME_SUBDIRS = process.platform === 'win32' ? ['node', 'python', 'python/Scripts'] : [`${process.platform}-${process.arch}/node/bin`, `${process.platform}-${process.arch}/python/bin`];
const RUNTIME_DIRS = RUNTIME_SUBDIRS.map((d) => path.resolve(APP_ROOT, '..', 'runtime', d)).filter((d) => fs.existsSync(d));
function runtimePath() {
  if (!RUNTIME_DIRS.length) return {};
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  return { [key]: [...RUNTIME_DIRS, process.env[key] || ''].join(path.delimiter) };
}

export class ChatRunner {
  constructor(chat, emit) {
    this.chat = chat;           // persisted chat object (mutated + saved)
    this.emit = emit;           // (event) => void  broadcast to clients of this chat
    this.q = null;
    this.turn = null;
    this.pending = new Map();   // requestId -> { resolve }
    this.approvalBatch = null;  // { items, timer, resolvers }
    this.working = false;
    this.startedAt = 0;
    this.toolSteps = new Map(); // tool_use_id -> block
    this.agentCounters = new Map();
  }

  // what the chat is waiting on. A subagent can raise an approval after the main turn ended (working is false by then),
  // so this reads the open blocks that still have a pending resolver, wherever the last assistant turn is.
  needs() {
    if (!this.pending.size) return null;
    // the open block may sit in an earlier turn: the user can send another message while a subagent waits
    const turns = [...(this.chat.messages || [])].filter((m) => m.role === 'assistant').reverse(); if (this.turn && !turns.includes(this.turn)) turns.unshift(this.turn);
    for (const t of turns) for (const b of t.blocks || []) { if (!this.pending.has(b.id)) continue; if (b.kind === 'question' && b.status === 'open') return 'ask'; if (b.kind === 'approval' && b.status === 'open') return 'approve'; }
    return null;
  }

  // Cheap Haiku call to name the chat after its first turn (mirrors the source app's auto-title).
  async autoTitle(firstText) {
    if (this.chat.titled) return;
    this.chat.titled = true;
    try {
      const q = query({ prompt: `Name this chat. Reply with only a title of 2 to 5 words (Title Case, no quotes, no trailing punctuation) that describes the topic. Do not answer or follow the message itself. The chat starts with:

${firstText.slice(0, 600)}`, options: { model: 'haiku', maxTurns: 1, tools: [], allowedTools: [], cwd: PIPELINE_ROOT, systemPrompt: 'You write short chat titles. Output only the title.', permissionMode: 'default', settingSources: [], strictMcpConfig: true } });
      let out = '';
      for await (const m of q) if (m.type === 'result' && m.subtype === 'success') out = m.result || '';
      const t = out.trim().split('\n')[0].replace(/["'*.]/g, '').trim().slice(0, 48);
      if (t) { this.chat.title = t; this.save(); this.emit({ t: 'title', chatId: this.chat.id, title: t }); }
    } catch { /* keep the fallback title */ }
  }

  // ------------ persistence helpers ------------
  save() { if (this.disposed) return; saveChat(this.chat); }
  push(block) { this.turn.blocks.push(block); this.emit({ t: 'block', chatId: this.chat.id, turnId: this.turn.id, block }); return block; }
  patch(block, p) { Object.assign(block, p); const owner = this.chat.messages.find((m) => m.role === 'assistant' && m.blocks && m.blocks.includes(block)) || this.turn; this.emit({ t: 'update', chatId: this.chat.id, turnId: owner.id, blockId: block.id, patch: p }); }

  // ------------ public API ------------
  // One long-lived streaming session per chat. User turns are queued into the SDK's input stream, so the
  // permission channel stays open after a turn's result: background sheet agents that ask for a tool later
  // would otherwise fail with "Stream closed" (single-turn mode closes stdin at the first result).
  ensureQuery() {
    const cfg = readConfig();
    const provider = providerFor(this.chat, cfg);
    const sig = JSON.stringify([this.chat.model || 'default', this.chat.effort || '', provider, Object.values(cfg.keys).map(Boolean)]);
    if (this.q && this.qSig === sig) return;
    if (this.q) this.closeQuery();
    this.qSig = sig;
    const queue = []; let wake = null; let ended = false;
    this.input = { push: (m) => { queue.push(m); if (wake) wake(); }, end: () => { ended = true; if (wake) wake(); } };
    async function* gen() { for (;;) { if (queue.length) { yield queue.shift(); continue; } if (ended) return; await new Promise((r) => { wake = r; }); wake = null; } }
    const abort = new AbortController();
    this.abort = abort;
    const opts = {
      cwd: PIPELINE_ROOT,
      abortController: abort,
      includePartialMessages: true,
      permissionMode: 'default',
      settingSources: ['project'],
      strictMcpConfig: true, // no claude.ai connectors or user MCP servers inside the pipeline session
      systemPrompt: { type: 'preset', preset: 'claude_code', append: this.chatRules() },
      env: { ...process.env, ...runtimePath(), ...Object.fromEntries(Object.entries(PROVIDER_ENV).map(([prov, name]) => [name, cfg.keys[prov] || undefined])), ...connectionEnv(cfg), GEN_PROVIDER: provider, VIDEO_PROVIDER: videoProviderFor(cfg) || '', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', SUPACOMPUTA: '1', SUPACOMPUTA_CHAT: this.chat.id, SUPACOMPUTA_URL: `http://127.0.0.1:${process.env.SUPACOMPUTA_PORT || 8797}` },
      canUseTool: (name, input, o) => this.canUseTool(name, input, o),
      stderr: (d) => { if (/error/i.test(d)) this.emit({ t: 'log', chatId: this.chat.id, line: String(d).slice(0, 300) }); },
    };
    if (this.chat.model && this.chat.model !== 'default') opts.model = this.chat.model;
    if (this.chat.effort) opts.effort = this.chat.effort;
    if (this.chat.sessionId) opts.resume = this.chat.sessionId;
    this.sessionCost = 0; this.owedResults = 0; // the CLI's counters start over with each process
    const q = query({ prompt: gen(), options: opts });
    this.q = q;
    (async () => {
      try {
        for await (const m of q) { if (this.q !== q) break; await this.onMessage(m); }
      } catch (e) {
        if (this.q !== q) return;
        const msg = String((e && e.message) || e);
        if (this.working && this.turn && this.turn.status === 'working') {
          this.push({ id: crypto.randomUUID(), kind: 'step', icon: 'warning', label: 'Run failed', sub: msg.slice(0, 120), status: 'error', warn: true });
          this.finish(abort.signal.aborted ? 'stopped' : 'error');
        }
      } finally {
        if (this.q === q) {
          this.q = null; this.input = null; this.abort = null;
          if (this.working && this.turn && this.turn.status === 'working') this.finish('error');
          this.working = false;
          for (const pr of this.pending.values()) pr.resolve(null);
          this.pending.clear();
          this.save();
        }
      }
    })();
  }

  // Every chat starts clean: no other job's files, no other brief, no memory of other chats.
  provider() { return providerFor(this.chat); }

  // A short balance-and-price note appended to every turn (the stored message stays the user's own words). It exists so
  // the agent picks a quality the balance can pay for BEFORE the first gen_image.py call, instead of learning it from a
  // quota rejection and retrying. Costs one free balance call per turn.
  async contextNote() {
    const cfg = readConfig(); const p = providerFor(this.chat, cfg); const key = cfg.keys[p];
    // video has its own key: its line is part of every note, whatever the image key's state
    const vp = videoProviderFor(cfg);
    const video = vp === 'piapi' ? 'PiAPI key stored: video clips render through tools/gen_video.py (Seedance 2.5, 480p $0.15/s, 720p $0.35/s, 1080p $0.80/s); the ElevenLabs key is not involved in video'
      : vp === 'elevenlabs' ? 'video clips render through tools/gen_video.py on the ElevenLabs Image & Video API (Seedance 2.5 / 2.0 / Fast / Mini; ElevenLabs credits, billed per second of output, the exact figure is logged after each clip); Kling is not on that API'
      : 'no video key (PiAPI or ElevenLabs): video clips cannot render until the user adds one in Settings';
    const bl = cfg.connections?.blender;
    const blender = bl?.path ? `Blender ${bl.version} is connected (BLENDER_PATH is set): motion previz clips render on this machine through tools/blender_previz.py, no credits` : 'Blender is not connected (See more > Connections in the app): no motion previz until the user connects it; never look for or run Blender yourself';
    if (!key) return `[Supacomputah context, not written by the user: no ${PROVIDER_NAMES[p]} key is stored, so gen_image.py will refuse to run (images only). Plan and write prompts, but tell the user an image key is needed before rendering images. ${video}. ${blender}.]`;
    const r = await providerCheck(p, key); if (!r.ok) return `[Supacomputah context, not written by the user: the ${PROVIDER_NAMES[p]} key is not being accepted right now (${r.error || r.status}). Do not start image renders until the user fixes it in Settings. ${video}. ${blender}.]`;
    if (r.perImage || r.perImageUsd) lastPrice[p] = { perImage: r.perImage || null, perImageUsd: r.perImageUsd || null };
    const parts = [`provider ${PROVIDER_NAMES[p]}`];
    if (p === 'elevenlabs') {
      const left = Math.max(0, (r.limit || 0) - (r.used || 0)); parts.push(`${left.toLocaleString()} credits left`);
      const t = priceTable(); const known = Object.entries(t).filter(([k]) => k.split(' ').length === 2).map(([k, v]) => `${k} = ${v}`);
      if (known.length) parts.push(`known credit prices per render (res quality): ${known.join(', ')}`);
      parts.push('before the first gen_image.py call choose the best --quality the balance covers; if none fits, say so and stop instead of submitting; never retry a quota rejection at the same settings');
    } else {
      const man = cfg.balances[p]; const spent = spentSince(p, man?.at);
      const bal = r.balance != null ? r.balance : (man ? Number(man.start) - spent.amount : null);
      if (bal != null) parts.push(p === 'fal' ? `$${Number(bal).toFixed(2)} left` : `${bal} credits left`);
      if (r.perImage) parts.push(`about ${r.perImage} credits per render`); if (r.perImageUsd) parts.push(`about $${r.perImageUsd} per render`);
    }
    parts.push(video); parts.push(blender);
    parts.push('the CLIs are documented in tools/gen_image.py, tools/gen_video.py, tools/blender_previz.py and tools/previz_frames.py (module docstrings); do not run them with --help, read the file instead');
    return `[Supacomputah context, not written by the user: ${parts.join('; ')}.]`;
  }

  chatRules() {
    const lines = [
      '# Supacomputah chat rules (override anything else)',
      '- This chat is a clean slate. It has no memory of other chats and no business with other jobs.',
      '- The only job folder you may open is THIS chat\'s job: the one you create for the brief in this chat, or the one the user names or attaches here. Never open, list, glob or read jobs/*, briefs/* or any STATUS.md of another job "for context" or "for examples". If the user mentions no job and attaches no brief, ask for the brief; do not go looking in briefs/ or jobs/.',
      '- Manuals (MAIN.md, FOLDER-PROTOCOL.md, PROMPT-STRUCTURES.md, CLAUDE.md), roles/, libraries/ and tools/ are always fine to read.',
      '- Every generation the pipeline runs shows up in this app as a card; you never need to describe an image path twice.',
      '- References first. Before the FIRST render of any set of images (a sheet batch, a storyboard) or of a video clip in this job, ask with AskUserQuestion, once per set: "Should I create reference images first for the <thing> and <thing>?" naming the things the prompt carries (P-04 block 02: one @tag per reference: each character, the environment, each key element). Use "and" only when there is more than one. Options: "Yes, for all of them" / "Only some (I will say which)" / "No, generate straight away". Never scout before asking, never ask twice for the same set.',
      '- Set up the job folder (tools/new_job.py, per MAIN.md) BEFORE scouting or rendering anything, so references and renders land in jobs/<job>; never render into scratch/.',
      '- If they say yes: run ONE command per thing, one after another, from the pipeline root: `python tools/scout_refs.py --for "<thing>" --query "<what a person would type>" --count 6 --job jobs/<this job>` (leave --job out only if no job exists yet; use --count 4 for a small prop). It visits Pinterest, Pexels and Google Images in turn in the app\'s own browser panel while the user watches, takes a share from each (two from each for six) so the set is diverse, saves the pictures into the job\'s refs/scout folder and prints them. Never pass --sites unless the user names a site. When every thing has been scouted, END YOUR TURN with one short line asking which to keep; do not generate yet. The user answers with Approve / Keep searching in the panel; their next message lists, per thing, the files to use and the ones to drop, with a ready-made string of --ref flags.',
      '- After that message: put every kept file on the gen_image.py command as its own --ref "<full path>" (repeat --ref, in the order given, all things together, at most 10). If they kept none, generate without references. "Keep searching" means run scout_refs.py again for that thing with --count = the number they dropped and --exclude for each dropped file; never show the same picture twice.',
      '- In your replies never name scripts, tools or commands (no new_job.py, no scout_refs.py, no gen_image.py, no flags). Say what you did in plain words: "I set up the job", "I found 3 references for the mug".',
      '- Paths: write a path once and bare (no prose around it, no repeating it). The app shows every path as a short link named after the item (character-01 v2, scene-01 still prompt, brief) that opens the file. Never tell the user to open Notepad or any editor: prompt and note files open in the app when clicked, the user edits them there, and the file is saved for you to read again.',
      '- When you show a prompt for the user to read, copy or change, put it in a fenced code block whose opening fence is ```prompt <path to its file, relative to the pipeline root> (or plain ```prompt when it has no file yet). One block per prompt, its item named on the line before. The app adds Copy and Inspect (edit) buttons to that block; do not paste the same prompt again in prose. When the user asks to see, review or check the prompts, show each prompt\'s full text in its own ```prompt block; a list of file links is not showing them.',
    ];
    const cfg = readConfig(); const prov = providerFor(this.chat, cfg);
    lines.push(`- Image generation provider for this chat: ${PROVIDER_NAMES[prov] || prov}. tools/gen_image.py reads it from GEN_PROVIDER; never pass --provider yourself, never mention, print or ask for API keys, never edit key files. If the user says the provider changed, it is already in effect for the next command.`);
    if (prov !== 'elevenlabs') lines.push('- The ElevenLabs credit counter does not apply to this provider; do not quote ElevenLabs credits for these renders.');
    const vp = videoProviderFor(cfg);
    lines.push(vp === 'piapi'
      ? '- Video clips render as Seedance 2.5 through PiAPI with tools/gen_video.py (the video director runs it on GO, per MAIN.md §5.3): the prompt plus the approved sheets in video.refs.txt, no frames. PiAPI offers 480p, 720p or 1080p (no 2k/4k), 4 to 30 seconds, aspect 21:9 to 9:16, billed per second ($0.15 / $0.35 / $0.80). Every clip stops in this app for approval, where the user can change those settings before it runs.'
      : vp === 'elevenlabs'
        ? '- Video clips render as Seedance through the ElevenLabs Image & Video API with tools/gen_video.py (the video director runs it on GO, per MAIN.md §5.3; the tool picks ElevenLabs by itself, never pass --provider): the prompt plus the approved sheets in video.refs.txt, no frames. Tiers: seedance-2.5 (480p/720p/1080p, 4 to 30 s), seedance-2, seedance-2-fast and seedance-2-mini (480p/720p, 4 to 15 s); no 2k/4k; Kling is not on that API. Cost is in ElevenLabs credits, per second of output, read from the account after each clip. Every clip stops in this app for approval, where the user can change the settings before it runs.'
        : '- No video key is stored (PiAPI or ElevenLabs), so tools/gen_video.py will refuse to run: plan and write the video prompt, then tell the user once that video needs a key in Settings (the Docs button beside the PiAPI key explains how to get one). Never ask for the key in chat.');
    const bl = cfg.connections?.blender;
    if (bl?.path) {
      lines.push(`- Blender ${bl.version} is connected: you can build a MOTION PREVIZ, a low-poly Blender render of the camera move that Seedance follows as a motion reference. When a scene's shot has a choreographed camera move (several moves in one shot, an orbit, a cinebot or drone path, a push that lands on a detail), ask ONCE before writing that scene's clip prompt, with AskUserQuestion: "This shot has a complex camera move. Should I build it in Blender first, so Seedance has a motion reference to follow?" Options: "Yes, build the previz" / "No, prompt only". When the user asks for a Blender project or a previz outright ("Create a new blender project…"), skip the question and build it; if no job exists yet, create one first (tools/new_job.py) and treat the previz as scene-01.`);
      lines.push('- The MOTION is the deliverable of a previz. Build the camera exactly the way libraries/blender-previz.md does: orbit parameters (r, el, az, tz, lens), a TIMELINE of states, quintic "whip" moves of 10 to 12 frames that stop dead, a slow creep during every hold (the camera never sits still), one keyframe per frame, motion blur on, a round studio. Never sparse keyframes with a TRACK_TO constraint and frozen holds: that reads as stiff and gets rejected.');
      lines.push('- How a previz is built: read libraries/blender-previz.md once, then write the Blender Python script YOURSELF with the Write tool (never through a subagent; the user watches the code appear in the chat) to jobs/<job>/scenes/scene-NN/previz-vN.py. Its first lines are a comment `# Blender: <the shots and camera moves in one or two lines>` (never `# Previz:`). Then run, from the pipeline root: `python tools/blender_previz.py --job jobs/<job> --item scene-NN --version N --script scenes/scene-NN/previz-vN.py --resolution 1080p --fps 24`. The app stops it for approval (the user can change resolution, fps, seconds and engine there), then it renders on this machine with no credits and the clip shows up as a card. Run that command in the FOREGROUND with the Bash tool timeout set to 600000 (a render takes minutes; the 2-minute default would cut it off); never run_in_background. Run it ALONE, exactly as written: no 2>&1, no | tail, no > file, nothing chained after it (the app reads its output to make the card; a pipe breaks the render). Do not narrate any of this (no "foreground", "timeout", "as the manual requires"): before the render say one plain line like "Rendering the Blender clip now", nothing more. If the result still says it timed out or is running in the background, Blender is still rendering: say so in one line and END YOUR TURN (the app attaches the clip to the card by itself); never re-run the render and never start another version for that. A real failure (a traceback in previz-vN.run.log): read the log, fix the script, run the next version (never render another way). On approval copy the clip to previz-approved.mp4 in the same folder.');
      lines.push('- AFTER THE RENDER: the card IS the review. Say in one or two lines what the camera does and stop. Do NOT extract frames, do NOT read the preview or the frames to check the shots, do NOT judge the motion yourself and do NOT render another version on your own. The user watches the clip; if they say the motion is wrong they will say what, and only then you change the script and render the next version. One render per request. The approval panel may have changed the resolution, seconds or engine of the command: that is the choice of the user, report the clip as it rendered and do not inspect the tool for it (no --help, no reading or grepping tools/blender_previz.py).');
      lines.push("- NAMING in the chat: call it the Blender clip, the Blender render or the Blender scene. Never say 'previz' or 'motion previz' to the user; the word only lives in file names (previz-vN.mp4, previz-approved.mp4) and in the pipeline's own files. That includes the library and the tool: say 'the Blender library' and 'the Blender render', never 'the previz library' or 'the previz tool'.");
      lines.push("- The approved previz is the VIDEO BLOCKING for the clip prompt, prompted Leo's way: \"Write a [x]-second Seedance prompt based on this video blocking. Read the input video and write out second by second to match the camera moves in the clip. [x] fps, (aspect ratio) [x]:[x]. [Scene description]\". Nobody can watch an mp4, so the video director first runs `python tools/previz_frames.py --job jobs/<job> --item scene-NN` (two labelled frames per second plus previz-frames/sheet.png), Reads the sheet and the frames, and writes the ACTION block one line per second matching the previz camera; the prompt's first line carries the length, fps and aspect. Pass `PREVIZ: scenes/scene-NN/previz-approved.mp4` in the video director's spawn prompt. Do not pass the mp4 to gen_video.py (the video tools take image sheets only).");
    } else lines.push('- Blender is not connected, so there is no motion previz in this chat. If the user asks for Blender work or a previz, say in one line that Blender connects under See more > Connections in the sidebar, then continue without it. Never look for or run Blender yourself.');
    if (this.chat.job) lines.push(`- This chat's job folder: jobs/${this.chat.job}`);
    const skills = listCustomSkills();
    if (skills.length) { lines.push('- Skills and roles the user uploaded (read the file when asked for it by name, then follow it):'); for (const k of skills) lines.push(`  - ${k.name} (${k.kind}): ${k.path}`); }
    return lines.join('\n');
  }

  // Ends the input stream (the CLI exits once its work is done) and hard-stops it if it lingers.
  closeQuery() {
    const q = this.q, abort = this.abort;
    this.q = null; this.input?.end(); this.input = null; this.abort = null;
    clearTimeout(this.idleTimer);
    if (q) setTimeout(() => { try { abort?.abort(); } catch { /* gone */ } }, 20000);
  }

  async send(text, files = [], display = '') {
    if (this.working) throw new Error('busy');
    clearTimeout(this.idleTimer);
    const userMsg = { id: crypto.randomUUID(), role: 'user', text, files, ts: Date.now(), ...(display ? { display } : {}) };
    this.chat.messages.push(userMsg);
    if (this.chat.title === 'New chat' && text.trim()) this.chat.title = text.trim().replace(/\s+/g, ' ').slice(0, 48);
    this.emit({ t: 'user', chatId: this.chat.id, message: userMsg, title: this.chat.title });

    this.turn = { id: crypto.randomUUID(), role: 'assistant', ts: Date.now(), status: 'working', blocks: [], durationMs: 0, cost: 0 };
    this.chat.messages.push(this.turn);
    this.save();
    this.working = true; this.startedAt = Date.now(); this.liveText = null;
    this.emit({ t: 'turn_start', chatId: this.chat.id, turn: { id: this.turn.id, ts: this.turn.ts } });

    let prompt = text;
    if (files.length) prompt += `\n\nAttached files (full paths, read them with the Read tool):\n${files.map((f) => `- ${f}`).join('\n')}`;

    const note = await this.contextNote().catch(() => ''); if (note) prompt += `\n\n${note}`;
    this.ensureQuery();
    if (!this.chat.titled && text.trim()) this.autoTitle(text); // in parallel, so the sidebar titles itself within seconds
    this.owedResults = (this.owedResults || 0) + 1; // each turn owes one result message, even when interrupted
    this.lastPrompt = prompt; this.resumeRetried = false;
    this.input.push({ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null, session_id: this.chat.sessionId || '' });
  }

  // Chat deleted or server shutting down: end the session for good.
  async dispose() { this.disposed = true; try { await this.stop(); } catch { /* ignore */ } this.closeQuery(); } // disposed = deleted: no late title/turn save may write the file back

  // The stop button: interrupt the current turn, keep the session (and any background agents) alive.
  async stop() {
    if (!this.working) return;
    this.turn.status = 'stopping';
    for (const b of this.turn.blocks) if (b.kind === 'image' && !b.path && (b.status === 'queued' || b.status === 'processing')) this.patch(b, { status: 'failed', error: 'Stopped' });
    for (const [, p] of this.pending) p.resolve({ stopped: true });
    this.pending.clear();
    try { await this.q?.interrupt(); } catch { /* ignore */ }
    // The CLI answers an interrupt with a result message; wait for it (briefly) so it cannot land on the next turn.
    const turn = this.turn;
    await new Promise((resolve) => { this.stopWait = resolve; setTimeout(resolve, 12000); });
    this.stopWait = null;
    if (this.turn === turn && this.working) { this.owedResults = Math.max(0, (this.owedResults || 0) - 1); this.finish('stopped'); }
  }

  answer(requestId, payload) {
    const p = this.pending.get(requestId);
    if (!p) return false;
    this.pending.delete(requestId);
    p.resolve(payload);
    return true;
  }

  finish(status) {
    if (!this.turn || this.turn.status === 'done' || this.turn.status === 'stopped' || this.turn.status === 'error') return;
    this.turn.status = status;
    this.turn.durationMs = Date.now() - this.startedAt;
    for (const b of this.turn.blocks) if (b.kind === 'step' && b.status === 'live') b.status = status === 'done' ? 'done' : 'stopped';
    this.working = false;
    this.emit({ t: 'turn_end', chatId: this.chat.id, turnId: this.turn.id, status, durationMs: this.turn.durationMs, cost: this.turn.cost, needs: this.needs() });
    this.save();
  }

  // ------------ permission surface: questions + generation approvals ------------
  async canUseTool(name, input, o) {
    if (name === 'AskUserQuestion') {
      const requestId = crypto.randomUUID();
      const block = this.push({ id: requestId, kind: 'question', questions: input.questions, answers: null, status: 'open' });
      const res = await new Promise((resolve) => {
        this.pending.set(requestId, { resolve });
        this.emit({ t: 'ask', chatId: this.chat.id, requestId, questions: input.questions });
      });
      if (!res || res.stopped) { this.patch(block, { status: 'skipped' }); return { behavior: 'deny', message: 'The user did not answer.' }; }
      if (res.skip) { this.patch(block, { status: 'skipped' }); return { behavior: 'deny', message: 'The user skipped this question. Continue with your best judgement and say what you assumed.' }; }
      this.patch(block, { answers: res.answers, status: 'answered' });
      return { behavior: 'allow', updatedInput: { questions: input.questions, answers: res.answers } };
    }
    if (name === 'Bash' || name === 'PowerShell') {
      const s = stepFor(name, input);
      if (s.gen && this.chat.mode === 'ask' && !this.chat.alwaysAllowGen) {
        if (!this.toolSteps.has(o.toolUseID)) this.registerGen({ id: o.toolUseID, name, input }, s, o.parentToolUseId || null);
        const res = await this.requestApproval({ toolUseID: o.toolUseID, command: String(input.command || ''), item: s.item, version: s.version, video: Boolean(s.video), previz: Boolean(s.previz) });
        const decision = res.decision;
        // the panel may have changed the video settings: the tool runs the rewritten command
        const allow = () => {
          const out = { ...input };
          if (res.command && res.command !== String(input.command || '')) out.command = res.command;
          if (s.previz) {   // a render takes minutes: never the 2-minute default, never backgrounded, never piped
            out.command = previzCommandOnly(out.command || input.command); out.timeout = 600000; out.run_in_background = false;
            if (out.command !== String(input.command || '')) this.patch(s, { command: out.command });
          }
          return { behavior: 'allow', updatedInput: out };
        };
        if (decision === 'allow') return allow();
        if (decision === 'always') { this.chat.alwaysAllowGen = true; this.save(); return allow(); }
        // "Stop" ends the run like the stop button does (deny + interrupt hangs the SDK for minutes; interrupting directly is immediate).
        if (decision === 'stop') setTimeout(() => this.stop(), 0);
        return { behavior: 'deny', message: 'The user stopped this generation. Do not retry it. Report and wait.' };
      }
    }
    return { behavior: 'allow' };
  }

  // Several sheet agents ask at once; batch them into one "Approve N image generations" panel.
  requestApproval(item) {
    return new Promise((resolve) => {
      if (!this.approvalBatch) {
        const requestId = crypto.randomUUID();
        this.approvalBatch = { requestId, items: [], resolvers: [], timer: null };
        this.approvalBatch.timer = setTimeout(() => this.flushApprovals(), 700);
      }
      const b = this.approvalBatch;
      const prompt = this.promptPreview(item.command);
      if (item.previz) { const params = previzParams(item.command); b.items.push({ ...item, prompt: this.previzPreview(item.command), provider: 'blender', credits: null, usd: null, params, n: b.items.length + 1 }); }
      else if (item.video) { const params = videoParams(item.command); b.items.push({ ...item, prompt, provider: params.provider, credits: params.credits, usd: params.usd, params, n: b.items.length + 1 }); }
      else b.items.push({ ...item, prompt, provider: this.provider(), credits: creditsFor(item.command, this.provider()), usd: usdFor(this.provider()), n: b.items.length + 1 });
      b.resolvers.push(resolve);
    });
  }

  // A previz has no prompt file: the approval shows the script's opening comment (the agent writes `# Blender: ...`).
  previzPreview(command) {
    const f = previzFiles(command); if (!f) return '';
    try {
      const lines = fs.readFileSync(f.script, 'utf8').split(/\r?\n/);
      const head = []; for (const l of lines) { if (/^\s*#/.test(l)) head.push(l.replace(/^\s*#\s?/, '')); else if (head.length || l.trim()) break; }
      const text = head.join('\n').trim();
      return text || `Render the camera move in ${path.basename(f.script)} with Blender on this machine.`;
    } catch { return `Render the camera move in ${path.basename(f.script)} with Blender on this machine.`; }
  }
  promptPreview(command) {
    const target = this.promptTargets(command);
    for (const f of target.files) { try { return fs.readFileSync(f, 'utf8').slice(0, 6000); } catch { /* next */ } }
    if (target.heredoc) return target.heredoc.slice(0, 6000);
    return '';
  }
  // Where a command's prompt text lives: the --prompt-file itself, then the file it is copied from (cp/copy/Copy-Item),
  // then the heredoc that writes it. Files are absolute paths inside the pipeline root.
  promptTargets(command) {
    const c = String(command || '');
    const abs = (p) => { const a = path.resolve(path.isAbsolute(p) ? p : path.join(PIPELINE_ROOT, p)); return a.startsWith(path.resolve(PIPELINE_ROOT) + path.sep) ? a : null; };
    const un = (t) => String(t || '').replace(/^["']|["']$/g, '');
    const pf = un((c.match(/--prompt-file\s+("[^"]+"|'[^']+'|\S+)/) || [])[1]);
    const files = []; let heredoc = null;
    if (pf) {
      const dst = abs(pf); if (dst) files.push(dst);
      const base = path.basename(pf).toLowerCase();
      for (const m of c.matchAll(/\b(?:cp|copy|Copy-Item)\s+(?:-\w+\s+)*("[^"]+"|'[^']+'|\S+)\s+("[^"]+"|'[^']+'|\S+)/gi)) {
        const src = un(m[1]), to = un(m[2]).replace(/[\\/]+$/, '');
        if (to.replace(/\\/g, '/').toLowerCase().endsWith(pf.replace(/\\/g, '/').toLowerCase()) || path.basename(to).toLowerCase() === base || dst && path.resolve(path.join(PIPELINE_ROOT, to)) === path.dirname(dst)) { const a = abs(src); if (a) files.push(a); }
      }
      const hd = c.match(/<<\s*-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1(?:\s|$)/);
      if (hd && new RegExp(path.basename(pf).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(c.slice(0, hd.index))) heredoc = hd[2];
    }
    return { promptFile: pf ? abs(pf) : null, files, heredoc };
  }

  // A prompt changed in the approval panel is written to the command's --prompt-file before the tool runs, so the
  // render uses the user's words. Only files inside the pipeline root.
  writePromptFor(command, text) {
    const t = this.promptTargets(command); let ok = false;
    const body = String(text).replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
    // write every file in the chain that exists (the copy source carries the edit into the destination the command creates)
    for (const f of t.files) { if (!/\.(txt|md)$/i.test(f)) continue; if (!fs.existsSync(f) && f !== t.promptFile) continue; if (!fs.existsSync(path.dirname(f))) continue; try { fs.writeFileSync(f, body, 'utf8'); ok = true; } catch { /* next */ } }
    return ok;
  }

  flushApprovals() {
    const b = this.approvalBatch; this.approvalBatch = null;
    if (!b) return;
    // Top-level generations already have a "Generation" step row: fold the request into it (sub "Approve image?").
    // Generations inside sheet agents have no row of their own, so the approval block renders one.
    const steps = b.items.map((i) => this.toolSteps.get(i.toolUseID)).filter(Boolean);
    for (const [k, i] of b.items.entries()) { const s = this.toolSteps.get(i.toolUseID); i.hasStep = Boolean(s); if (s) this.patch(s, { sub: i.previz ? 'Approve Blender clip?' : i.video ? 'Approve video?' : 'Approve image?', awaiting: true, prompt: (i.prompt || '').slice(0, 600), command: i.command.slice(0, 4000), credits: i.credits, provider: i.provider, usd: i.usd, params: i.params, n: k + 1 }); }
    const block = this.push({ id: b.requestId, kind: 'approval', items: b.items.map((i) => ({ n: i.n, item: i.item, version: i.version, video: i.video, previz: Boolean(i.previz), prompt: i.prompt, command: i.command.slice(0, 4000), hasStep: i.hasStep, credits: i.credits, provider: i.provider, usd: i.usd, params: i.params })), status: 'open', decision: null });
    this.pending.set(b.requestId, {
      resolve: (res) => {
        const d = !res || res.stopped ? 'stop' : res.decision;
        if (d !== 'stop' && res?.prompts && typeof res.prompts === 'object') for (const i of b.items) { const t = res.prompts[i.n]; if (typeof t === 'string' && t.trim() && this.writePromptFor(i.command, t)) { i.prompt = t; const s = this.toolSteps.get(i.toolUseID); if (s) this.patch(s, { prompt: t.slice(0, 600) }); } }
        // video settings changed in the panel (resolution, seconds, aspect, model, sound): the command is rewritten
        // before it runs, and the row shows the new price
        if (d !== 'stop' && res?.params && typeof res.params === 'object') for (const i of b.items) { const w = res.params[i.n]; if (i.video && w && typeof w === 'object') { const next = i.previz ? applyPrevizParams(i.command, w) : applyVideoParams(i.command, w); if (next !== i.command) { i.command = next; i.params = i.previz ? previzParams(next) : videoParams(next); i.usd = i.params.usd; const s = this.toolSteps.get(i.toolUseID); if (s) this.patch(s, { command: next.slice(0, 4000), params: i.params, usd: i.usd }); } } }
        this.patch(block, { status: 'decided', decision: d, items: block.items.map((x) => { const i = b.items.find((y) => y.n === x.n); return i ? { ...x, command: i.command.slice(0, 4000), params: i.params, usd: i.usd } : x; }) });
        for (const s of steps) { this.patch(s, { awaiting: false, sub: d === 'stop' ? 'Rejected' : 'Preparing', status: d === 'stop' ? 'error' : 'live', rejected: d === 'stop' }); if (d !== 'stop') this.queueCard(s); else this.stopCard(s, 'Stopped'); }
        for (const [k, r] of b.resolvers.entries()) r({ decision: d, command: b.items[k].command });
      },
    });
    this.emit({ t: 'approve_request', chatId: this.chat.id, requestId: b.requestId, items: block.items });
  }

  // ------------ SDK message stream → UI blocks ------------
  async onMessage(m) {
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          if (!this.chat.sessionId) { this.chat.sessionId = m.session_id; this.save(); }
          if (!cachedModels) { try { const l = await this.q.supportedModels(); if (l && l.length) cachedModels = prettyModels(l); this.emit({ t: 'models', models: cachedModels }); } catch { /* keep static */ } }
        } else if (m.subtype === 'task_notification') {
          const step = [...this.toolSteps.values()].find((s) => s.taskId === m.task_id || s.toolUseId === m.tool_use_id);
          if (step) this.patch(step, { status: m.status === 'completed' ? 'done' : 'error', sub: m.status === 'completed' ? 'Done' : m.status, detail: /^(cd |python |\S+\.py|.*&&)/.test(m.summary || '') ? step.detail : (m.summary || '').slice(0, 400) });
        }
        return;
      case 'stream_event': return this.onStream(m);
      case 'assistant': return this.onAssistant(m);
      case 'user': return this.onToolResult(m);
      case 'result':
        { const total = m.total_cost_usd || 0; const delta = Math.max(0, total - (this.sessionCost || 0)); this.sessionCost = total; if (this.turn) this.turn.cost = (this.turn.cost || 0) + delta; } // total_cost_usd is cumulative for the session
        // the chat's saved session is gone (Claude re-login, cleaned transcripts): start a fresh session and resend once
        if (m.is_error && m.subtype !== 'success' && /No conversation found with session ID/i.test((m.errors || []).join('; ')) && this.chat.sessionId && !this.resumeRetried && this.lastPrompt && this.turn && this.turn.status === 'working') {
          this.resumeRetried = true; this.chat.sessionId = ''; this.save();
          this.push({ id: crypto.randomUUID(), kind: 'step', icon: 'info', label: 'Session expired', sub: 'Starting a fresh agent session for this chat; it re-reads the job folder', status: 'done' });
          const prompt = this.lastPrompt; this.closeQuery(); this.ensureQuery(); this.owedResults = 1;
          this.input.push({ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null, session_id: '' });
          return;
        }
        if (m.session_id) this.chat.sessionId = m.session_id;
        if ((this.owedResults || 0) > 1) { this.owedResults--; return; } // a stale result from a turn that already ended (stop timeout)
        this.owedResults = 0;
        if (this.turn && this.turn.status === 'stopping') { this.finish('stopped'); if (this.stopWait) this.stopWait(); }
        else if (this.turn && this.turn.status === 'working') {
          if (m.is_error && m.subtype !== 'success') this.push({ id: crypto.randomUUID(), kind: 'step', icon: 'warning', label: 'Run ended with an error', sub: (m.errors || []).join('; ').slice(0, 160), status: 'error', warn: true });
          this.finish(m.is_error && m.subtype !== 'success' ? 'error' : 'done');
        }
        this.working = false; this.liveText = null; this.save();
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => { if (!this.working) this.closeQuery(); }, 15 * 60 * 1000);
        return;
      default: return;
    }
  }

  onStream(m) {
    if (m.parent_tool_use_id) return; // subagent internals stay folded into their agent row
    const ev = m.event;
    if (ev.type === 'content_block_start') {
      const cb = ev.content_block;
      if (cb.type === 'thinking') {
        this.liveThink = this.push({ id: crypto.randomUUID(), kind: 'step', icon: 'thought', label: 'Thinking it through', sub: '', status: 'live', thinking: true });
      } else if (cb.type === 'text') {
        this.liveText = this.push({ id: crypto.randomUUID(), kind: 'text', text: cb.text || '', streaming: true });
      } else if (cb.type === 'tool_use' && /^(Write|Edit)$/.test(cb.name)) {
        this.liveTool = { id: cb.id, name: cb.name, json: '', block: null, sent: 0, old: '' };
      }
    } else if (ev.type === 'content_block_delta') {
      const d = ev.delta;
      if (d.type === 'input_json_delta' && this.liveTool) {
        this.liveTool.json += d.partial_json || ''; this.feedCode();
      } else if (d.type === 'text_delta' && this.liveText) {
        this.liveText.text += d.text;
        this.emit({ t: 'delta', chatId: this.chat.id, turnId: this.turn.id, blockId: this.liveText.id, text: d.text });
      } else if (d.type === 'thinking_delta' && this.liveThink && d.thinking) {
        this.liveThink.detail = (this.liveThink.detail || '') + d.thinking;
        this.emit({ t: 'think', chatId: this.chat.id, turnId: this.turn.id, blockId: this.liveThink.id, text: d.thinking });
      }
    } else if (ev.type === 'content_block_stop') {
      if (this.liveTool) { this.finishCode(); this.liveTool = null; }
      if (this.liveThink) { this.patch(this.liveThink, { label: 'Thought it through', status: 'done', detail: (this.liveThink.detail || '').slice(0, 12000) }); this.liveThink = null; }
      if (this.liveText) { this.finishText(this.liveText); this.liveText = null; }
    }
  }

  // A script being written (Write/Edit of a .py in the job) shows up in the chat as the code streams in, like a code
  // editor: the tool's JSON input arrives in pieces, and the strings are decoded as far as they go.
  feedCode() {
    const t = this.liveTool; const ps = partialStrings(t.json);
    const file = ps.file_path?.text || '';
    if (!t.block) {
      if (!ps.file_path?.done || !/\.py$/i.test(file)) return;
      t.block = this.push({ id: crypto.randomUUID(), kind: 'code', toolUseId: t.id, tool: t.name, file, name: base(file), rel: REL(file), code: '', old: '', status: 'live', streaming: true, edit: t.name === 'Edit' });
      this.toolSteps.set(t.id, t.block);
    }
    const key = t.name === 'Edit' ? 'new_string' : 'content';
    if (t.name === 'Edit' && ps.old_string && ps.old_string.text !== t.old) { t.old = ps.old_string.text; t.block.old = t.old; this.emit({ t: 'update', chatId: this.chat.id, turnId: this.turn.id, blockId: t.block.id, patch: { old: t.old } }); }
    const text = ps[key]?.text || '';
    if (text.length > t.sent) { const add = text.slice(t.sent); t.sent = text.length; t.block.code += add; this.emit({ t: 'code', chatId: this.chat.id, turnId: this.turn.id, blockId: t.block.id, text: add }); }
  }
  finishCode() {
    const t = this.liveTool; if (!t.block) { this.feedCode(); if (!t.block) return; }
    let input = null; try { input = JSON.parse(t.json); } catch { /* partial */ }
    const code = input ? String(t.name === 'Edit' ? input.new_string || '' : input.content || '') : t.block.code;
    const old = input && t.name === 'Edit' ? String(input.old_string || '') : t.block.old;
    this.patch(t.block, { code, old, streaming: false });
  }

  finishText(block) {
    block.streaming = false;
    const media = mediaPathsIn(block.text);
    this.emit({ t: 'update', chatId: this.chat.id, turnId: this.turn.id, blockId: block.id, patch: { streaming: false } });
    for (const p of media) this.addGateImage(p, block);
    const job = (block.text.match(/jobs[\\/]([0-9]{4}-[0-9]{2}-[0-9]{2}-[\w-]+)/) || [])[1];
    if (job && this.chat.job !== job) { this.chat.job = job; this.emit({ t: 'job', chatId: this.chat.id, job }); }
  }

  addGateImage(p, afterBlock) {
    const existing = this.turn.blocks.find((b) => b.kind === 'image' && b.path === p);
    if (existing) { if (existing.status === 'generated') this.patch(existing, { status: 'gate' }); return; }
    // Mentioned again in a later turn: the earlier card already carries it.
    if (this.chat.messages.some((m) => m.role === 'assistant' && m !== this.turn && (m.blocks || []).some((b) => b.kind === 'image' && b.path === p))) return;
    const meta = labelForMedia(p);
    // approved.png is the pipeline's own copy of an accepted version: nothing left to approve.
    const status = meta.version === 'approved' ? 'approved' : 'gate';
    const block = { id: crypto.randomUUID(), kind: 'image', path: p, ...meta, status, decision: status === 'approved' ? 'approve' : null, video: /\.mp4$/i.test(p), ts: Date.now() };
    this.push(block);
    if (meta.job && this.chat.job !== meta.job) { this.chat.job = meta.job; this.emit({ t: 'job', chatId: this.chat.id, job: meta.job }); }
  }

  onAssistant(m) {
    const content = Array.isArray(m.message?.content) ? m.message.content : [];
    if (m.parent_tool_use_id) {
      // A subagent is working: count its tool uses under the parent agent row.
      const parent = this.toolSteps.get(m.parent_tool_use_id);
      const uses = content.filter((c) => c.type === 'tool_use');
      if (parent && uses.length) {
        parent.count = (parent.count || 0) + uses.length;
        const last = stepFor(uses[uses.length - 1].name, uses[uses.length - 1].input);
        this.patch(parent, { count: parent.count, sub: `${last.label}${last.sub ? ' · ' + last.sub : ''}` });
      }
      // A generation inside a sheet agent gets its own row (so the approval folds into it) and a queued card.
      for (const u of uses) {
        if (this.toolSteps.has(u.id)) continue;
        const s = stepFor(u.name, u.input);
        if (!s.gen) continue;
        this.registerGen(u, s, m.parent_tool_use_id);
      }
      return;
    }
    // Text blocks arrive via stream events; here we only register tool uses.
    for (const c of content) {
      if (c.type !== 'tool_use') continue;
      if (this.toolSteps.has(c.id)) continue;
      if (c.name === 'AskUserQuestion') continue; // rendered by canUseTool as a question block
      const s = stepFor(c.name, c.input);
      if (s.gen) { this.registerGen(c, s, null); continue; }
      const block = this.push({ id: crypto.randomUUID(), kind: 'step', icon: s.icon, label: s.label, sub: s.sub, status: 'live', toolUseId: c.id, tool: c.name, item: s.item, version: s.version, gen: false, agent: Boolean(s.agent) });
      this.toolSteps.set(c.id, block);
    }
  }

  // One Generation row per gen_image.py / browser_video.py call. In Ask mode the queued card waits for the approval;
  // otherwise it appears at once (Higgsfield: "Generation · Started" + a Queued tile under the text).
  registerGen(use, s, parentId) {
    const command = String(use.input?.command || '');
    const params = s.previz ? previzParams(command) : s.video ? videoParams(command) : null;
    const block = this.push({ id: crypto.randomUUID(), kind: 'step', icon: s.icon, label: s.label, sub: s.sub, status: 'live', toolUseId: use.id, tool: use.name, item: s.item, version: s.version, gen: true, agent: false, video: Boolean(s.video), previz: Boolean(s.previz), agentChild: Boolean(parentId), command: command.slice(0, 4000), provider: s.video ? params.provider : this.provider(), credits: s.video ? params.credits : creditsFor(command, this.provider()), usd: s.video ? params.usd : usdFor(this.provider()), params });
    this.toolSteps.set(use.id, block);
    const waits = this.chat.mode === 'ask' && !this.chat.alwaysAllowGen;
    this.queueCard(block, waits);
    return block;
  }

  queueCard(step, waiting = false) {
    const existing = this.cardFor(step);
    if (existing) { if (!waiting && existing.waiting) this.startCard(existing); return existing; }
    if (!waiting) this.patch(step, { sub: 'Started' }); // source wording: Generation · Started
    const card = this.push({ id: crypto.randomUUID(), kind: 'image', path: null, status: 'queued', waiting, item: step.item || '', version: step.version ? 'v' + step.version : '', job: this.chat.job || null, stepId: step.id, video: Boolean(step.video), previz: Boolean(step.previz), credits: step.credits || null, ts: Date.now() });
    if (!waiting) this.startCard(card);
    return card;
  }
  // gen_image.py is silent until the file lands (~60 to 110 s); after a moment the tile reads Processing, like the source.
  startCard(card) {
    if (card.waiting) this.patch(card, { waiting: false });
    setTimeout(() => { if (card.status === 'queued' && !card.path) this.patch(card, { status: 'processing' }); }, 4000);
    if (card.previz) this.watchPreviz(card);
  }
  // A previz renders frame by frame on this machine; the tool keeps the latest frame in previz-vN.preview.png, and the
  // card shows it while the render runs (the tool's own output only arrives when it ends).
  watchPreviz(card) {
    const step = this.chat.messages.flatMap((m) => (m.role === 'assistant' ? m.blocks : [])).find((b) => b.id === card.stepId);
    const f = step ? previzFiles(step.command) : null; if (!f) return;
    let last = 0; const started = Date.now();
    const tick = () => {
      if (card.path || card.status === 'failed' || Date.now() - started > 3 * 3600 * 1000) return;
      try { const st = fs.statSync(f.preview); if (st.mtimeMs !== last && st.size > 0) { last = st.mtimeMs; this.patch(card, { preview: f.preview, previewAt: Math.round(st.mtimeMs), status: 'processing' }); } } catch { /* not yet */ }
      // the tool's own result may never reach us (backgrounded, timed out): when the clip is written and Blender has quit, the card becomes the clip
      try {
        if (fs.existsSync(f.mp4) && fs.existsSync(f.blend) && fs.existsSync(f.log)) {
          const tail = fs.readFileSync(f.log, 'utf8').slice(-4000);
          const done = /PREVIZ_RENDER_SECONDS|Blender quit/.test(tail) && Date.now() - fs.statSync(f.mp4).mtimeMs > 2500;
          if (done) { this.addGeneratedImage(path.resolve(f.mp4), step); if (step && step.status !== 'done') this.patch(step, { status: 'done', sub: 'Done', warn: false }); this.save(); return; }
        }
      } catch { /* not yet */ }
      setTimeout(tick, 1500);
    };
    setTimeout(tick, 1500);
  }
  stopCard(step, why = 'Stopped') { const c = this.cardFor(step); if (c && !c.path && c.status !== 'failed') this.patch(c, { status: 'failed', waiting: false, error: why }); }
  cardFor(step) { return this.chat.messages.flatMap((m) => (m.role === 'assistant' ? m.blocks : [])).find((b) => b.kind === 'image' && b.stepId === step.id) || null; }

  onToolResult(m) {
    const content = Array.isArray(m.message?.content) ? m.message.content : [];
    for (const c of content) {
      if (c.type !== 'tool_result') continue;
      const step = this.toolSteps.get(c.tool_use_id);
      const text = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : '';
      if (!step) { this.harvestGeneration(text, null); continue; }
      const isErr = Boolean(c.is_error);
      if (step.rejected) continue; // the row already reads "Rejected"
      if (!this.chat.job) {   // the job folder a tool just made or named (new_job.py prints it) is this chat's job
        const job = (text.match(/jobs[\/]([0-9]{4}-[0-9]{2}-[0-9]{2}-[\w-]+)/) || [])[1];
        if (job) { this.chat.job = job; this.emit({ t: 'job', chatId: this.chat.id, job }); }
      }
      if (step.gen) {
        const saved = this.harvestGeneration(text, step);
        if (!saved && step.previz && /^Command running in background|timed out after|Command timed out/im.test(text)) {
          // Blender is still rendering: the step stays live and watchPreviz() turns the card into the clip when the mp4 lands
          this.patch(step, { status: 'live', sub: 'Rendering', detail: text.slice(0, 300) });
          continue;
        }
        const failed = isErr || !saved;
        const why = (text.match(/quota[^"\n]*?(\d+) credits are required/i) ? `Needs ${text.match(/(\d+) credits are required/)[1]} credits`
          : text.match(/^gen_(?:image|video)\.py: error: (.*)$/m) ? `Wrong arguments: ${text.match(/^gen_(?:image|video)\.py: error: (.*)$/m)[1]}`
          : text.match(/^(rejected \(nothing charged\)|generation failed|no \w+ key|poll failed|connection error|timeout:)[^\n]*/mi)?.[0]
          || (isErr ? (text.split('\n').find((l) => l.trim() && !/^exit code/i.test(l)) || '') : '')).replace(/[\uFFFD\u0000-\u0008]/g, '').trim().slice(0, 140);
        this.patch(step, { status: failed ? 'error' : 'done', sub: isErr ? 'Failed' : saved ? 'Done' : (text.match(/rejected|failed|no key|quota/i) ? 'Failed' : 'Done'), warn: failed, detail: failed ? text.slice(0, 600) : step.detail });
        const card = this.cardFor(step);
        if (card && failed && !card.path) this.patch(card, { status: 'failed', error: why || 'Failed' });
      } else if (step.agent) {
        this.patch(step, { status: isErr ? 'error' : 'done', sub: isErr ? 'Failed' : 'Done', detail: text.slice(0, 600) });
        this.harvestGeneration(text, null);
        const media = mediaPathsIn(text);
        for (const p of media) this.addGeneratedImage(p);
      } else {
        this.patch(step, { status: isErr ? 'error' : 'done', warn: isErr, sub: isErr ? (text.slice(0, 80) || 'Failed') : step.sub });
        // new_job.py prints "created .../jobs/<folder>": bind the chat to its job right away, so references scouted
        // before the first render land in the job instead of the inbox.
        if (step.label === 'Created job' && !isErr) { const m = text.match(/created\s+\S*?jobs\/([\w.-]+)/); if (m && this.chat.job !== m[1] && fs.existsSync(path.join(PIPELINE_ROOT, 'jobs', m[1]))) { this.chat.job = m[1]; this.save(); this.emit({ t: 'job', chatId: this.chat.id, job: m[1] }); } }
      }
    }
  }

  // "saved <path>  (N KB, N s, run #N, credits: N)" is gen_image.py's success line.
  harvestGeneration(text, step) {
    let found = false;
    for (const m of text.matchAll(/saved\s+(.+?\.(?:png|jpg|jpeg|webp|mp4))\s*\(/gi)) {
      let p = m[1].trim();
      if (!path.isAbsolute(p)) p = path.join(PIPELINE_ROOT, p);
      if (fs.existsSync(p)) { this.addGeneratedImage(path.resolve(p), step); found = true; }
    }
    return found;
  }

  addGeneratedImage(p, step) {
    const all = this.chat.messages.flatMap((m) => (m.role === 'assistant' ? m.blocks : []));
    if (all.some((b) => b.kind === 'image' && b.path === p)) return;
    const meta = labelForMedia(p);
    const card = step ? this.cardFor(step) : null;
    const previz = /previz-v\d+\.mp4$/i.test(p);
    const fields = { path: p, ...meta, status: 'generated', decision: null, video: /\.mp4$/i.test(p), previz, ts: Date.now() };
    if (card && !card.path) this.patch(card, fields); // the queued tile becomes the picture
    else this.push({ id: crypto.randomUUID(), kind: 'image', ...fields, stepId: step ? step.id : undefined });
    if (previz) { const blend = p.replace(/\.mp4$/i, '.blend'); if (fs.existsSync(blend)) this.emit({ t: 'previz_done', chatId: this.chat.id, blend, mp4: p }); }
    if (meta.job && this.chat.job !== meta.job) { this.chat.job = meta.job; this.emit({ t: 'job', chatId: this.chat.id, job: meta.job }); }
  }
}
