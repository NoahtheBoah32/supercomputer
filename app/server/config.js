// SupaComputa local config. Everything private lives OUTSIDE the repo, in the user's home folder.
//   %USERPROFILE%\.supacomputa\config.json   -> { keys: { elevenlabs, higgsfield, fal, piapi }, provider, model, effort, mode, name }
//   %USERPROFILE%\.supacomputa\chats\<id>.json
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_DIR = process.env.SUPACOMPUTA_HOME || path.join(os.homedir(), '.supacomputa');
export const CHATS_DIR = path.join(CONFIG_DIR, 'chats');
export const UPLOADS_DIR = path.join(CONFIG_DIR, 'uploads');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// The pipeline this UI drives. Override with SUPACOMPUTA_PIPELINE=<folder>.
export const PIPELINE_ROOT = process.env.SUPACOMPUTA_PIPELINE
  || path.resolve(APP_ROOT, '..', 'Leo Workflow');

for (const d of [CONFIG_DIR, CHATS_DIR, UPLOADS_DIR]) fs.mkdirSync(d, { recursive: true });

// Generation providers the pipeline can render with. The image providers are a priority list (`provider` is the
// default; a chat can override it). PiAPI is the video provider (Seedance 2.5 through tools/gen_video.py): one key,
// never part of the image choice.
export const PROVIDERS = ['elevenlabs', 'higgsfield', 'fal', 'piapi'];
export const IMAGE_PROVIDERS = ['elevenlabs', 'higgsfield', 'fal'];
export const VIDEO_PROVIDERS = ['piapi', 'elevenlabs'];
// The provider video clips render with: the Settings choice when its key is stored, else PiAPI, else ElevenLabs
// (its Image & Video API carries Seedance too; Kling is not on it). null = no video key at all.
export function videoProviderFor(cfg = readConfig()) {
  const want = cfg.videoProvider;
  if (VIDEO_PROVIDERS.includes(want) && cfg.keys[want]) return want;
  return VIDEO_PROVIDERS.find((p) => cfg.keys[p]) || null;
}
export const PROVIDER_NAMES = { elevenlabs: 'ElevenLabs', higgsfield: 'Higgsfield', fal: 'fal', piapi: 'PiAPI' };
// Environment variable each key is handed to the pipeline as (tools/gen_image.py and tools/gen_video.py read these).
export const PROVIDER_ENV = { elevenlabs: 'ELEVENLABS_API_KEY', higgsfield: 'HIGGSFIELD_API_KEY', fal: 'FAL_KEY', piapi: 'PIAPI_API_KEY' };
const EMPTY_KEYS = { elevenlabs: '', higgsfield: '', fal: '', piapi: '' };
// Higgsfield has no balance endpoint and fal only shows one to admin keys, so the user can type a balance once and the
// app counts it down with the pipeline's own per-render cost logs: balances[provider] = { start, at } (at = ISO time set).
const DEFAULTS = { keys: { ...EMPTY_KEYS }, balances: {}, provider: 'elevenlabs', model: 'default', effort: 'medium', mode: 'ask', name: '' };

export function readConfig() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* first run */ }
  const c = { ...DEFAULTS, ...raw, keys: { ...EMPTY_KEYS, ...(raw.keys || {}) }, balances: { ...(raw.balances || {}) } };
  if (raw.elevenlabsKey && !c.keys.elevenlabs) c.keys.elevenlabs = raw.elevenlabsKey; // pre-multi-provider config
  delete c.elevenlabsKey;
  if (!IMAGE_PROVIDERS.includes(c.provider)) c.provider = 'elevenlabs';
  return c;
}

export function writeConfig(patch) {
  const cur = readConfig();
  const next = { ...cur, ...patch, keys: { ...cur.keys, ...(patch.keys || {}) }, balances: { ...cur.balances, ...(patch.balances || {}) } };
  for (const k of Object.keys(next.balances)) if (next.balances[k] == null) delete next.balances[k];
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  return next;
}

// What the browser is allowed to know about the config. The key itself never leaves this process.
export function publicConfig() {
  const c = readConfig();
  const keys = Object.fromEntries(PROVIDERS.map((p) => [p, Boolean(c.keys[p])]));
  return { hasKey: Object.values(keys).some(Boolean), keys, balances: c.balances, provider: c.provider, videoProvider: VIDEO_PROVIDERS.includes(c.videoProvider) ? c.videoProvider : 'auto', videoProviderActive: videoProviderFor(c), cvAuto: c.cvAuto !== false, model: c.model, effort: c.effort, mode: c.mode, name: c.name, pipelineRoot: PIPELINE_ROOT };
}

// The image provider a chat renders with: its own choice, else the default, else the first image provider with a key.
export function providerFor(chat, cfg = readConfig()) {
  const want = IMAGE_PROVIDERS.includes(chat?.provider) ? chat.provider : cfg.provider;
  if (cfg.keys[want]) return want;
  return IMAGE_PROVIDERS.find((p) => cfg.keys[p]) || want;
}
