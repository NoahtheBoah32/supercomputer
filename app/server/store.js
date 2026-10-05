// Chat persistence: one JSON file per chat under ~/.supacomputa/chats.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CHATS_DIR } from './config.js';

const file = (id) => path.join(CHATS_DIR, `${id}.json`);

export function listChats() {
  const out = [];
  for (const f of fs.readdirSync(CHATS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const c = JSON.parse(fs.readFileSync(path.join(CHATS_DIR, f), 'utf8'));
      out.push({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, job: c.job || null, pinned: !!c.pinned });
    } catch { /* skip broken file */ }
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function newChat(partial = {}) {
  const now = Date.now();
  const chat = {
    id: crypto.randomUUID(),
    title: partial.title || 'New chat',
    createdAt: now,
    updatedAt: now,
    sessionId: null,
    model: partial.model || 'default',
    effort: partial.effort || 'medium',
    mode: partial.mode || 'ask',
    alwaysAllowGen: false,
    job: null,
    messages: [],
  };
  saveChat(chat);
  return chat;
}

export function loadChat(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  let chat; try { chat = JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; }
  if (healPicks(chat)) { try { fs.writeFileSync(file(id), JSON.stringify(chat, null, 1), 'utf8'); } catch { /* read-only is fine */ } }
  return chat;
}
// Older builds created the "your picks" set before checking the click hit a picture, so a miss left an open, empty
// set that blocked the References view with nothing to remove. Such sets become 'empty' (hidden) on load.
function healPicks(chat) {
  let changed = false;
  for (const m of chat.messages || []) {
    if (m.role !== 'assistant') continue;
    for (const b of m.blocks || []) if (b.kind === 'refs' && b.picked && b.status === 'open' && !(b.items || []).length) { b.status = 'empty'; changed = true; }
  }
  return changed;
}

export function saveChat(chat) {
  chat.updatedAt = Date.now();
  fs.writeFileSync(file(chat.id), JSON.stringify(chat, null, 1), 'utf8');
  return chat;
}

export function deleteChat(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return false;
  try { fs.unlinkSync(file(id)); return true; } catch { return false; }
}
