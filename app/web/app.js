// SupaComputa front end. Vanilla ES module; talks to the local server over REST + WebSocket.
import { icon } from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fileUrl = (p) => '/api/file?p=' + encodeURIComponent(p);
const isVideo = (p) => /\.(mp4|webm)$/i.test(p || '');
const LOGO = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2.75C13 8 16 11 21.25 12C16 13 13 16 12 21.25C11 16 8 13 2.75 12C8 11 11 8 12 2.75Z" fill="currentColor"/></svg>';
const CLAUDE_MARK = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5l1.9 5.2 5.3.4-4.2 3.3 1.6 5.2L12 14.6l-4.6 3 1.6-5.2-4.2-3.3 5.3-.4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const EFFORTS = [['low', 'Low', 'Fastest, lightest reasoning'], ['medium', 'Medium', 'Balanced speed and depth'], ['high', 'High', 'Deeper reasoning for complex work'], ['xhigh', 'Extra high', 'Very thorough, slower'], ['max', 'Max', 'Maximum reasoning budget']];
// Generation providers. The pipeline renders through whichever one the chat (or the default priority) points at.
const PROVS = [
  ['elevenlabs', 'ElevenLabs', 'sk_…', 'Image & Video API key from elevenlabs.io: GPT Image 2 images, and Seedance video when no PiAPI key is stored. Credits show in the top bar.'],
  ['higgsfield', 'Higgsfield', 'KEY_ID:KEY_SECRET', 'Cloud API key pair from platform.higgsfield.ai, pasted as key id, a colon, then the secret.'],
  ['fal', 'fal', 'key_id:secret', 'FAL_KEY from fal.ai/dashboard/keys.'],
  ['piapi', 'PiAPI', 'your PiAPI key', 'Video: Seedance 2.5 through piapi.ai. Pay as you go in USD, no subscription needed.', 'docs'],
];
// The image providers are a priority list; PiAPI only renders video and never takes part in that choice.
const IMAGE_PROVS = PROVS.filter(([v]) => v !== 'piapi');
const PROV_NAME = Object.fromEntries(PROVS.map(([v, n]) => [v, n]));
function curProvider() { const want = S.chat?.provider || S.config.provider || 'elevenlabs'; if (S.config.keys?.[want]) return want; return IMAGE_PROVS.map((p) => p[0]).find((p) => S.config.keys?.[p]) || want; }
function modelName(provider) { return { elevenlabs: 'GPT Image 2', higgsfield: 'Higgsfield Soul 2', fal: 'GPT Image 1.5 · fal', piapi: 'Seedance 2.5 · PiAPI' }[provider || 'elevenlabs'] || 'GPT Image 2'; }
// Seedance on PiAPI, mirrored from server/agent.js VIDEO_MODELS: USD per second of output by resolution.
const VIDEO_MODELS = {
  'seedance-2.5': { name: 'Seedance 2.5', price: { '480p': 0.15, '720p': 0.35, '1080p': 0.80 }, max: 30 },
  'seedance-2.5-less-restriction': { name: 'Seedance 2.5 · less restriction', price: { '480p': 0.165, '720p': 0.385, '1080p': 0.88 }, max: 30 },
  'seedance-2': { name: 'Seedance 2.0', price: { '480p': 0.10, '720p': 0.20, '1080p': 0.50 }, max: 15 },
  'seedance-2-fast': { name: 'Seedance 2.0 Fast', price: { '480p': 0.048, '720p': 0.096 }, max: 15 },
  'seedance-2-mini': { name: 'Seedance 2.0 Mini', price: { '480p': 0.042, '720p': 0.084 }, max: 15 },
};
// The same tiers on the ElevenLabs Image & Video API: priced in ElevenLabs credits (learned from the logs, else shown after the clip).
const EL_VIDEO_MODELS = {
  'seedance-2.5': { name: 'Seedance 2.5', res: ['480p', '720p', '1080p'], max: 30 },
  'seedance-2': { name: 'Seedance 2.0', res: ['480p', '720p', '1080p'], max: 15 },
  'seedance-2-fast': { name: 'Seedance 2.0 Fast', res: ['480p', '720p'], max: 15 },
  'seedance-2-mini': { name: 'Seedance 2.0 Mini', res: ['480p', '720p'], max: 15 },
  'veo-3.1': { name: 'Veo 3.1 (no sheets)', res: ['720p', '1080p'], max: 8, fixed: [4, 6, 8] },
  'veo-3.1-fast': { name: 'Veo 3.1 Fast (no sheets)', res: ['720p', '1080p'], max: 8, fixed: [4, 6, 8] },
};
const VIDEO_PROV_NAME = { piapi: 'PiAPI', elevenlabs: 'ElevenLabs' };
function videoCatalog(provider) { return provider === 'elevenlabs' ? EL_VIDEO_MODELS : Object.fromEntries(Object.entries(VIDEO_MODELS).map(([k, m]) => [k, { name: m.name, res: Object.keys(m.price), max: m.max, usd: m.price }])); }
const VIDEO_ASPECTS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const videoUsd = (pr) => { const m = VIDEO_MODELS[pr?.model] || VIDEO_MODELS['seedance-2.5']; const per = m.price[pr?.resolution] ?? m.price['1080p'] ?? m.price['720p']; return Math.round(per * (Number(pr?.duration) || 6) * 100) / 100; };
// The price of one clip as text: dollars on PiAPI, credits on ElevenLabs when the logs have taught the rate.
function videoCost(pr, table) { if (!pr) return ''; if (pr.provider === 'blender') return 'no credits'; if ((pr.provider || 'piapi') === 'piapi') return `~$${videoUsd(pr).toFixed(2)}`; const per = (table || pr.creditTable || {})[`${pr.model} ${pr.resolution}`]; return per ? `~${(per * pr.duration).toLocaleString()} credits` : 'credits after the clip'; }
function videoLabel(pr) { if (!pr) return 'Seedance 2.5 · PiAPI'; if (pr.provider === 'blender') return `Blender${pr.version ? ' ' + pr.version : ''} · ${pr.resolution} · ${pr.fps} fps${pr.seconds ? ' · ' + pr.seconds + ' s' : ''} · ${pr.engine === 'workbench' ? 'Workbench' : 'Eevee'}`; const cat = videoCatalog(pr.provider || 'piapi'); const m = cat[pr.model] || cat['seedance-2.5']; return `${m.name} · ${VIDEO_PROV_NAME[pr.provider || 'piapi']} · ${pr.resolution} · ${pr.duration} s · ${pr.aspect}${pr.audio === false ? ' · no sound' : ''}`; }
function providerStatus(p, cr) { // one line for menus and settings
  if (!S.config.keys?.[p]) return 'No key';
  if (!cr || cr.provider !== p) return 'Key stored';
  if (!cr.ok) return 'Key not working';
  if (p === 'elevenlabs') return `${Math.max(0, (cr.limit || 0) - (cr.used || 0)).toLocaleString()} credits left`;
  if (p === 'piapi') return cr.balance != null ? `$${Number(cr.balance).toFixed(2)} left · ~$4.80 per 6 s clip at 1080p` : '~$4.80 per 6 s clip at 1080p · set a balance in Settings';
  if (p === 'fal') return cr.balance != null ? `$${Number(cr.balance).toFixed(2)} left${cr.perImageUsd ? ` · ~$${cr.perImageUsd}/image` : ''}` : (cr.perImageUsd ? `~$${cr.perImageUsd}/image · set a balance in Settings` : 'Ready');
  return cr.balance != null ? `${Number(cr.balance).toLocaleString()} credits left${cr.perImage ? ` · ${cr.perImage}/image` : ''}` : (cr.perImage ? `${cr.perImage} credits/image · set a balance in Settings` : 'Ready');
}
const PLACEHOLDERS = ['Ask Supercomputer anything', 'Start a new job from a brief', 'Make the reference sheets for scene 2', 'Approve v2 and continue', 'What is left on the current job?'];

const S = {
  cvMode: 'history', scout: null, refsSel: null, bro: { open: false, url: '', title: '', w: 1000, h: 700, pick: false, frame: null },
  connections: null, bl: { open: false, opening: false, frame: null, kind: 'jpeg', w: 1100, h: 700, file: '', state: null, embed: true, error: '', version: '', placed: null, checked: '' },
  status: null, config: {}, models: [], chats: [], chat: null, view: 'home', page: null,
  ws: null, wsReady: false, attachments: { home: [], chat: [] }, timer: null,
  ask: null, approve: null, cvOpen: false, cvJob: null, cvView: 'grid', jobs: [], briefs: [], skills: [],
  expanded: new Set(), menu: null, atBottom: true, sidebarCollapsed: false,
};
window.S = S; // debugging and UI tests; the app itself never reads window.S
S.fn = { closeBrowserTab, removeRef, dismissPicks, renderRefsView, setCVWidth, openTaskList, parseStatus, loadTasks, onEvent: (m) => onEvent(m), showApprove, decide, showAsk: (...a) => showAsk(...a), toggleCV: (...a) => toggleCV(...a), renderCV: (...a) => renderCV(...a) }; // for tests

// ---------------------------------------------------------------- boot
function mountIcons(root = document) {
  for (const el of $$('[data-icon]', root)) { el.innerHTML = icon(el.dataset.icon); el.removeAttribute('data-icon'); const svg = el.firstElementChild; if (svg && !el.classList.contains('i16') && el.tagName === 'SPAN' && !el.className) { /* size via css */ } }
  for (const el of $$('[data-logo]', root)) { el.innerHTML = LOGO; el.removeAttribute('data-logo'); }
}
async function api(path, opts) {
  const r = await fetch(path, opts && opts.body && typeof opts.body !== 'string' && !(opts.body instanceof Blob) ? { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, body: JSON.stringify(opts.body) } : opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, body: j });
  return j;
}
function show(screen) { for (const s of $$('.screen')) s.classList.toggle('on', s.id === screen); }
function toast(msg, err, action) {
  const t = h(`<div class="toast${err ? ' err' : ''}"><span>${esc(msg)}</span>${action ? `<button class="toast-act">${esc(action.label)}</button>` : ''}</div>`);
  $('#toasts').appendChild(t);
  const gone = () => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); };
  if (action) $('.toast-act', t).onclick = () => { action.fn(); gone(); };
  setTimeout(gone, action ? 7000 : 3800);
  return t;
}

async function boot() {
  mountIcons();
  wireLogin(); wireKey(); wireApp();
  await refreshStatus();
}
let loginPoll = null;
async function refreshStatus() {
  try { S.status = await api('/api/status'); } catch (e) { $('#login-status').textContent = 'Server unreachable'; $('#login-sub').textContent = e.message; return; }
  S.config = S.status.config; S.models = S.status.models || [];
  const c = S.status.claude;
  $('#login-version').textContent = S.status.version ? `Claude Code ${S.status.version.replace(/\(.*\)/, '').trim()}` : '';
  if (!c.installed) { setLogin('bad', 'Claude Code is not installed', 'Install it first: npm install -g @anthropic-ai/claude-code'); startLoginPoll(); show('s-login'); return; }
  if (!c.loggedIn) { setLogin('bad', 'Not logged in', 'Click the button, finish the login in the terminal window, then come back.'); startLoginPoll(); show('s-login'); return; }
  setLogin('ok', `Logged in as ${c.email || 'your Claude account'}`, c.subscription ? `Claude ${c.subscription[0].toUpperCase()}${c.subscription.slice(1)}` : '');
  clearInterval(loginPoll); loginPoll = null;
  if (!S.config.hasKey && !sessionStorage.getItem('sc-skip-key')) { renderKeyGate(); show('s-key'); return; }
  await enterApp();
}
function setLogin(kind, text, sub) { $('#login-dot').className = 'status-dot ' + kind; $('#login-status').textContent = text; $('#login-sub').textContent = sub || ''; $('#login-open').hidden = kind === 'ok'; }
function startLoginPoll() { if (loginPoll) return; loginPoll = setInterval(refreshStatus, 3000); }
function wireLogin() {
  $('#login-open').onclick = async () => { $('#login-error').textContent = ''; try { await api('/api/login/open', { method: 'POST', body: {} }); setLogin('wait', 'Waiting for the login to finish…', 'A terminal window opened. Complete the sign-in there.'); startLoginPoll(); } catch (e) { $('#login-error').textContent = e.message; } };
  $('#login-recheck').onclick = refreshStatus;
  document.addEventListener('keydown', (e) => { if ($('#s-login').classList.contains('on') && e.key === 'Enter' && !$('#login-open').hidden) $('#login-open').click(); });
}
function renderKeyGate(focus) {
  const rows = $('#key-rows'); const inFile = S.status?.keysInFile || {};
  rows.innerHTML = PROVS.map(([v, n, ph, hint, docs]) => `<div class="key-row" data-p="${v}">
      <div class="key-head"><span class="nm">${n}</span><span class="st ${S.config.keys?.[v] ? 'ok' : ''}">${S.config.keys?.[v] ? 'Stored · verified' : 'Not set'}</span></div>
      <div class="field"><input type="password" placeholder="${S.config.keys?.[v] ? 'Paste a new key to replace it' : esc(ph)}" spellcheck="false" autocomplete="off" autocapitalize="off"><button type="button" class="eye" title="Show">${icon('content_viewer')}</button><button type="button" class="btn sm lime key-verify">${S.config.keys?.[v] ? 'Replace' : 'Verify'}</button></div>
      <div class="key-hint">${esc(hint)}${docs ? ` <button type="button" class="key-docs">Docs: how to get the key</button>` : ''}${inFile[v] ? ` <button type="button" class="key-import">Use the key from API-KEYS.local.md</button>` : ''}</div>
    </div>`).join('');
  mountIcons(rows);
  for (const row of $$('.key-row', rows)) {
    const p = row.dataset.p, input = $('input', row), st = $('.st', row), btn = $('.key-verify', row);
    $('.eye', row).onclick = () => { input.type = input.type === 'password' ? 'text' : 'password'; };
    const done = (r) => { input.value = ''; input.placeholder = 'Paste a new key to replace it'; S.config.keys = { ...(S.config.keys || {}), [p]: true }; S.config.hasKey = true; st.className = 'st ok'; st.textContent = r.unverified ? 'Stored · could not fully verify' : `Verified${r.limit != null ? ` · ${Math.max(0, r.limit - r.used).toLocaleString()} credits` : r.balance != null ? ` · $${Number(r.balance).toFixed(2)}` : r.perImage ? ` · ${r.perImage} credits/image` : ''}`; btn.textContent = 'Replace'; $('#key-error').textContent = ''; };
    const fail = (err) => { st.className = 'st bad'; st.textContent = 'Not accepted'; $('#key-error').textContent = err.body?.error || err.message; };
    const verify = async () => {
      const key = input.value.trim(); if (!key) { input.focus(); return; }
      btn.disabled = true; btn.textContent = 'Verifying…'; st.className = 'st'; st.textContent = 'Checking with ' + PROV_NAME[p] + '…';
      try { done(await api('/api/key', { method: 'POST', body: { provider: p, key } })); } catch (err) { fail(err); btn.textContent = 'Verify'; }
      finally { btn.disabled = false; if (btn.textContent === 'Verifying…') btn.textContent = 'Replace'; }
    };
    btn.onclick = verify;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); verify(); } });
    const docs = $('.key-docs', row); if (docs) docs.onclick = () => openDocs(p);
    const imp = $('.key-import', row); if (imp) imp.onclick = async () => { imp.disabled = true; try { done(await api('/api/key/import', { method: 'POST', body: { provider: p } })); } catch (err) { fail(err); } finally { imp.disabled = false; } };
  }
  const first = $(`.key-row[data-p="${focus || 'elevenlabs'}"] input`, rows); if (first) setTimeout(() => first.focus(), 50);
}
function wireKey() {
  $('#key-skip').onclick = () => { sessionStorage.setItem('sc-skip-key', '1'); enterApp(); };
  $('#key-continue').onclick = () => { if (!S.config.hasKey) sessionStorage.setItem('sc-skip-key', '1'); enterApp(); };
  $('#s-key').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('.key-row')) $('#key-continue').click(); });
}

// ---------------------------------------------------------------- app shell
async function enterApp() {
  show('s-app');
  if (S.entered) { // back from the key screen: the app is already running, just refresh what the keys affect
    S.status = await api('/api/status').catch(() => S.status); if (S.status?.config) S.config = { ...S.config, ...S.status.config };
    syncTriggers(); refreshCredits(); return;
  }
  S.entered = true;
  const c = S.status?.claude || {};
  $('#sb-name').firstChild.textContent = (S.config.name || c.email || 'Claude').split('@')[0];
  $('#sb-sub').textContent = c.subscription ? `Claude ${c.subscription}` : '';
  $('#sb-avatar').textContent = ((S.config.name || c.email || 'S')[0] || 'S').toUpperCase();
  $('#home-title').textContent = `${S.config.name ? S.config.name.split(' ')[0] + ', what' : 'What'} are we creating today?`;
  loadConnections();
  connectWS();
  await Promise.all([loadChats(), loadHome(), refreshCredits()]);
  syncTriggers();
  const id = location.hash.replace(/^#chat=/, '');
  if (id && S.chats.some((c) => c.id === id)) openChat(id); else goHome();
  startTypewriter();
}
function wireApp() {
  // The composer floats over the thread, so the thread's bottom padding must always clear it (it grows with attachments, questions and approval panels).
  { const dock = $('.chat-bottom'), col = $('#chat-col'); const fit = () => { const need = dock.offsetHeight + 24; if (parseInt(col.style.paddingBottom) !== need) { col.style.paddingBottom = need + 'px'; if (S.atBottom) scrollBottom(true); } }; new ResizeObserver(fit).observe(dock); fit(); }
  $('#sb-new').onclick = () => goHome(true);
  $('#sb-collapse').onclick = () => setSidebar(true);
  $('#tb-expand').onclick = () => setSidebar(false);
  $('#sb-seemore').onclick = () => { const m = $('#sb-more'); m.hidden = !m.hidden; $('#sb-seemore .grow').textContent = m.hidden ? 'See more' : 'See less'; };
  $('#sb-chats-toggle').onclick = () => { const l = $('#sb-chats'); l.hidden = !l.hidden; $('#sb-chats-toggle').style.transform = l.hidden ? 'rotate(-90deg)' : ''; };
  for (const b of $$('[data-page]')) b.onclick = () => openPage(b.dataset.page);
  $('#sb-search').onclick = openSearch;
  $('#sb-settings').onclick = openSettings;
  $('#sb-notif').onclick = () => toast('No notifications yet.');
  $('#sb-credits').onclick = () => { refreshCredits(true); };
  $('#tb-cv').onclick = () => toggleCV();
  $('#cv-close').onclick = () => { S.cvDismissed = true; toggleCV(false); };
  // the panel's left edge drags it wider or narrower (the browser inside follows)
  try { const w = Number(localStorage.getItem('cvWidth')); setCVWidth(w >= 360 ? w : 420); } catch { setCVWidth(420); }
  const edge = $('#cv-resize');
  edge.onpointerdown = (e) => {
    e.preventDefault(); edge.setPointerCapture(e.pointerId); document.body.classList.add('cv-dragging');
    const move = (ev) => setCVWidth(innerWidth - ev.clientX);
    edge.onpointermove = move;
    edge.onpointerup = edge.onpointercancel = () => { edge.onpointermove = null; edge.onpointerup = edge.onpointercancel = null; document.body.classList.remove('cv-dragging'); try { localStorage.setItem('cvWidth', String(parseInt($('#cv').style.width) || 420)); } catch { /* ignore */ } broFit(); if (typeof blSync === 'function') blSync(); };
  };
  window.addEventListener('resize', () => { setCVWidth(cvWidth()); clearTimeout(S.broFitTimer); S.broFitTimer = setTimeout(broFit, 250); });
  $('#cv-view').onclick = () => { S.cvView = S.cvView === 'grid' ? 'list' : 'grid'; renderCV(); };
  $('#cv-filter').onclick = () => { S.cvFilter = S.cvFilter === 'approved' ? '' : 'approved'; $('#cv-filter').classList.toggle('on', Boolean(S.cvFilter)); renderCV(); };
  $('#cv-job').onclick = (e) => openJobMenu(e.currentTarget);
  $('#tb-popout').onclick = () => { const job = S.chat?.job; if (!job) return toast('No job folder on this chat yet.'); api('/api/open-folder', { method: 'POST', body: { path: S.jobs.find((j) => j.name === job)?.dir || '' } }).catch(() => {}); };
  $('#tb-scheduled').onclick = () => toast('Scheduling is not wired to the pipeline yet.');
  $('#tb-usage').onclick = () => { const cost = (S.chat?.messages || []).reduce((a, m) => a + (m.cost || 0), 0); toast(`This chat: $${cost.toFixed(3)} of API-equivalent usage (covered by your Claude plan).`); };
  $('#tb-progress').onclick = (e) => { e.stopPropagation(); if (S.menu?.el.classList.contains('tasks')) closeMenu(); else openTaskList(e.currentTarget); };
  $('#tb-title').onclick = startRename;
  $('#lb-close').onclick = () => $('#lightbox').classList.remove('on');
  $('#lightbox').onclick = (e) => { if (e.target === e.currentTarget) $('#lightbox').classList.remove('on'); };
  $('#docs').onclick = (e) => { if (e.target === e.currentTarget) $('#docs').classList.remove('on'); };
  $('#settings').onclick = (e) => { if (e.target === e.currentTarget) $('#settings').classList.remove('on'); };
  $('#file-input').onchange = () => addFiles([...$('#file-input').files]);
  $('#skill-file').onchange = async () => { const f = $('#skill-file').files[0]; $('#skill-file').value = ''; if (!f) return; try { const r = await fetch('/api/skills/upload', { method: 'POST', headers: { 'x-filename': encodeURIComponent(f.name), 'content-type': 'application/octet-stream' }, body: f }).then((x) => x.json()); if (!r.ok) throw new Error(r.error || 'Upload failed'); toast(`${r.kind === 'skill' ? 'Skill' : 'Role'} "${r.name}" added. Say "use the ${r.name} ${r.kind}" in any chat.`); await loadHome(); if (S.page === 'skills' && S.view === 'page') openPage('skills'); } catch (e) { toast(e.message, true); } };
  for (const t of $$('#home-tabs .tab')) t.onclick = () => { for (const x of $$('#home-tabs .tab')) x.classList.toggle('active', x === t); renderHomeCards(t.dataset.tab); };
  wireComposer('home'); wireComposer('chat');
  const sc = $('#chat-scroll');
  sc.addEventListener('scroll', () => { S.atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80; $('#scroll-down').classList.toggle('show', !S.atBottom); });
  $('#scroll-down').onclick = () => scrollBottom(true);
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', (e) => { if (S.menu && !S.menu.el.contains(e.target) && !S.menu.anchor.contains(e.target)) closeMenu(); });
  window.addEventListener('resize', () => { if (S.menu) positionMenu(); });
  document.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length && $('#s-app').classList.contains('on')) { e.preventDefault(); addFiles(files); } });
  for (const id of ['home-composer', 'chat-composer']) { const el = $('#' + id); el.addEventListener('dragover', (e) => { e.preventDefault(); el.style.boxShadow = 'inset 0 0 0 1.5px var(--lime-border)'; }); el.addEventListener('dragleave', () => { el.style.boxShadow = ''; }); el.addEventListener('drop', (e) => { e.preventDefault(); el.style.boxShadow = ''; addFiles([...e.dataTransfer.files]); }); }
}
function setSidebar(collapsed) { S.sidebarCollapsed = collapsed; $('#app').classList.toggle('collapsed', collapsed); $('#tb-expand').hidden = !collapsed; setCVWidth(cvWidth()); }
function onKey(e) {
  if (!$('#s-app').classList.contains('on')) return;
  if (e.key === 'Escape') { if (S.menu) return closeMenu(); if ($('#lightbox').classList.contains('on')) return $('#lightbox').classList.remove('on'); if ($('#docs').classList.contains('on')) return $('#docs').classList.remove('on'); if ($('#settings').classList.contains('on')) return $('#settings').classList.remove('on'); if (S.inspect) return hideInspect(); if (S.ask) return answerSkip(); if (S.approve) return decide('stop'); if (S.chat?.working) return stopTurn(); }
  if (e.ctrlKey && e.key === 'Enter' && !S.ask && !S.approve) { e.preventDefault(); goHome(true); return; }
  if (isCloseKey(e) && S.cvOpen) { e.preventDefault(); closeBrowserTab(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
  if ($('#search').classList.contains('on')) return; // the palette handles its own keys
  if (S.ask && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const tgt = e.target; const typing = tgt && (tgt.isContentEditable || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'INPUT');
    if (/^[1-9]$/.test(e.key) && !typing) { const q = S.ask.questions[S.ask.index]; const n = Number(e.key) - 1; if (q.options[n]) { toggleOption(n); e.preventDefault(); } }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); answerSubmit(); }
  }
  if (e.key === 'Enter' && e.target?.closest?.('.pr.edit')) return; // editing a prompt: Enter is a newline
  if (S.inspect && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveInspect(); return; }
  if (S.approve && e.key === 'Enter' && !e.shiftKey) { const tgt = e.target; if (tgt && tgt.isContentEditable && tgt.textContent.trim()) { e.preventDefault(); decide('stop', tgt.textContent.trim()); return; } e.preventDefault(); decide('allow'); }
}

// ---------------------------------------------------------------- chats list
async function loadChats() { S.chats = await api('/api/chats'); renderChats(); }
const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z"/><path d="M12 15v6"/></svg>';
function renderChats() {
  const list = $('#sb-chats'), pinnedList = $('#sb-pinned'), pinnedHead = $('#sb-pinned-h');
  list.innerHTML = ''; pinnedList.innerHTML = '';
  const pinned = S.chats.filter((c) => c.pinned), rest = S.chats.filter((c) => !c.pinned);
  pinnedHead.hidden = pinnedList.hidden = !pinned.length;
  if (!S.chats.length) { list.appendChild(h('<div class="sb-empty">No chats yet</div>')); return; }
  const row = (c) => {
    const pill = c.needs === 'ask' ? '<span class="pill" style="color:#5B91FE;background:rgba(91,145,254,.05)">Needs reply</span>' : c.needs === 'approve' ? '<span class="pill" style="color:#5B91FE;background:rgba(91,145,254,.05)">Needs approval</span>' : '';
    const el = h(`<div class="chat-item${S.chat?.id === c.id ? ' active' : ''}${c.working ? ' working' : ''}${c.pinned ? ' pinned' : ''}" data-id="${c.id}" role="button" tabindex="0"><span class="t">${esc(c.title)}</span>${pill}${c.pinned ? `<span class="pinmark" title="Pinned">${PIN_SVG}</span>` : ''}<span class="more" title="More">${icon('h_chat_actions')}</span></div>`);
    el.onclick = (e) => { if (e.target.closest('.more')) { chatRowMenu(c, e.target.closest('.more')); return; } if (el.querySelector('.t').isContentEditable) return; openChat(c.id); };
    el.oncontextmenu = (e) => { e.preventDefault(); chatRowMenu(c, el, { x: e.clientX, y: e.clientY }); };
    el.onkeydown = (e) => { if (e.key === 'Enter' && !el.querySelector('.t').isContentEditable) openChat(c.id); };
    return el;
  };
  for (const c of pinned) pinnedList.appendChild(row(c));
  for (const c of rest) list.appendChild(row(c));
}
// Right-click or the "…" on a chat row: Rename, Pin, Delete (the same three the source offers).
function chatRowMenu(c, anchor, at) {
  if (S.menu?.anchor === anchor && !at) return closeMenu();
  const el = openMenu(anchor, 'ctx', `<button class="crow" data-act="rename">${icon('edit')}<span>Rename</span></button><button class="crow" data-act="pin">${PIN_SVG}<span>${c.pinned ? 'Unpin' : 'Pin'}</span></button><div class="csep"></div><button class="crow danger" data-act="delete">${icon('close_x')}<span>Delete</span></button>`, { above: false, at });
  for (const b of $$('.crow', el)) b.onclick = async (e) => {
    e.stopPropagation(); closeMenu(); const act = b.dataset.act;
    if (act === 'rename') renameRow(c);
    else if (act === 'pin') { const pinned = !c.pinned; await api('/api/chats/' + c.id, { method: 'PATCH', body: { pinned } }).catch(() => toast('Could not pin that.', true)); c.pinned = pinned; if (S.chat?.id === c.id) S.chat.pinned = pinned; renderChats(); toast(pinned ? 'Pinned' : 'Unpinned'); }
    else if (act === 'delete') deleteChat(c.id);
  };
}
function renameRow(c) {
  const el = document.querySelector(`.chat-item[data-id="${c.id}"] .t`); if (!el) return;
  el.contentEditable = 'true'; el.classList.add('editing'); el.focus(); document.execCommand('selectAll', false, null);
  let finished = false;
  const done = async (keep) => {
    if (finished) return; finished = true;
    el.contentEditable = 'false'; el.classList.remove('editing');
    const t = el.textContent.trim().replace(/\s+/g, ' ');
    if (!keep || !t || t === c.title) { el.textContent = c.title; return; }
    await api('/api/chats/' + c.id, { method: 'PATCH', body: { title: t } }).catch(() => toast('Could not rename that.', true));
    c.title = t; if (S.chat?.id === c.id) { S.chat.title = t; $('#tb-title').textContent = t; } renderChats();
  };
  el.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } };
  el.onblur = () => done(true);
}
function upsertChatRow(chat) { const i = S.chats.findIndex((c) => c.id === chat.id); const row = { id: chat.id, updatedAt: chat.updatedAt || Date.now() }; for (const k of ['title', 'working', 'needs', 'pinned']) if (chat[k] !== undefined) row[k] = chat[k]; if (i >= 0) S.chats[i] = { ...S.chats[i], ...row }; else if (!row.title) row.title = 'New chat'; else S.chats.unshift(row); S.chats.sort((a, b) => b.updatedAt - a.updatedAt); renderChats(); }
async function deleteChat(id) { if (!confirm('Delete this chat? Files in the job folder stay.')) return; await api('/api/chats/' + id, { method: 'DELETE' }); S.chats = S.chats.filter((c) => c.id !== id); if (S.chat?.id === id) goHome(); renderChats(); }

// ---------------------------------------------------------------- views
function setView(v) { S.view = v; for (const el of $$('.view')) el.classList.remove('on', 'fade'); const t = $('#v-' + v); t.classList.add('on', 'fade'); $('#tb-title').hidden = v !== 'chat'; $('#tb-progress').hidden = v !== 'chat'; $('#tb-popout').hidden = v !== 'chat'; }
function goHome(focus) { resetBro(); S.queue = []; if (S.ask || S.approve || S.inspect || panelHost().querySelector('.surface')) { S.inspect = null; hidePanel(); } S.chat = null; S.ask = null; S.approve = null; stopTimer(); location.hash = ''; setView('home'); renderChats(); syncTriggers(); refreshCredits(); if (focus) $('#home-editor').focus(); }
function resetBro() { S.bro = { open: false, url: '', title: '', w: S.bro.w, h: S.bro.h, box: null, pick: false, frame: null }; S.scout = null; S.bl = { ...S.bl, open: false, opening: false, frame: null, state: null, error: '', placed: null }; }
async function openChat(id) { resetBro();
  const chat = await api('/api/chats/' + id).catch(() => null);
  if (!chat) return toast('That chat is gone.', true);
  // a panel left open on the previous chat (approval, question, Inspect) must not hide this chat's composer
  if (S.ask || S.approve || S.inspect || panelHost().querySelector('.surface')) { S.inspect = null; hidePanel(); }
  S.chat = chat; S.ask = null; S.approve = null; S.expanded = new Set();
  location.hash = 'chat=' + id;
  setView('chat'); $('#tb-title').textContent = chat.title; renderChats();
  $('#chat-editor').textContent = ''; S.attachments.chat = []; renderAttach('chat');
  renderConversation();
  // restore pending requests if any
  const lastTurn = [...chat.messages].reverse().find((m) => m.role === 'assistant');
  S.queue = [];
  if (lastTurn && (chat.working || chat.needs)) { for (const b of chat.messages.filter((m) => m.role === 'assistant').flatMap((m) => m.blocks || [])) { if (b.kind === 'question' && b.status === 'open') enqueueRequest('ask', { requestId: b.id, questions: b.questions }); if (b.kind === 'approval' && b.status === 'open') enqueueRequest('approve', { requestId: b.id, items: b.items }); } }
  syncTriggers(); refreshCredits(); updateProgress(); scrollBottom(false);
  if (S.cvOpen) { S.cvJob = null; renderCV(); }
}
function startRename() { const el = $('#tb-title'); if (el.classList.contains('editing')) return; el.classList.add('editing'); el.contentEditable = 'true'; el.focus(); document.execCommand('selectAll', false, null); const done = async () => { el.classList.remove('editing'); el.contentEditable = 'false'; const t = el.textContent.trim(); if (t && S.chat && t !== S.chat.title) { S.chat.title = t; await api('/api/chats/' + S.chat.id, { method: 'PATCH', body: { title: t } }); upsertChatRow(S.chat); } else el.textContent = S.chat?.title || ''; }; el.onblur = done; el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } if (e.key === 'Escape') { el.textContent = S.chat.title; el.blur(); } }; }

// ---------------------------------------------------------------- home
async function loadHome() { const [jobs, briefs, skills] = await Promise.all([api('/api/jobs').catch(() => []), api('/api/briefs').catch(() => []), api('/api/skills').catch(() => [])]); S.jobs = jobs; S.briefs = briefs; S.skills = skills; renderHomeCards($('#home-tabs .tab.active')?.dataset.tab || 'all'); }
function renderHomeCards(tab) {
  const wrap = $('#home-cards'); wrap.innerHTML = '';
  const items = [];
  if (tab === 'all' || tab === 'jobs') for (const j of S.jobs) items.push({ kind: 'Job', title: j.name.replace(/^\d{4}-\d{2}-\d{2}-/, ''), sub: `${j.count} file${j.count === 1 ? '' : 's'}`, cover: j.cover, icon: 'project_folder', onclick: () => { S.cvJob = j.name; toggleCV(true); } });
  if (tab === 'all' || tab === 'briefs') for (const b of S.briefs) items.push({ kind: 'Brief', title: b.name.replace(/\.(md|txt)$/i, ''), sub: 'Brief', icon: 'viewed_skill', onclick: () => { attachPath(b.path, b.name, 'home'); $('#home-editor').textContent = 'Start a new job from this brief.'; $('#home-editor').focus(); updateSend('home'); } });
  if (tab === 'all' || tab === 'skills') for (const s of S.skills) items.push({ kind: s.kind === 'role' ? 'Role' : 'Skill', title: s.name, sub: s.description, icon: s.kind === 'role' ? 'loaded_skills' : 'h_skills_bolt', onclick: () => { $('#home-editor').textContent = s.kind === 'role' ? `Deploy the ${s.name} role: ` : `Use the ${s.name} skill: `; placeCaretEnd($('#home-editor')); updateSend('home'); } });
  if (!items.length) { wrap.appendChild(h(`<div class="card empty"><div class="media">${icon('project_folder')}</div><div class="cap"><span class="chip">${icon('plus')}</span><div><div class="ct">Nothing here yet</div><div class="cs">Jobs, briefs and skills from the pipeline show up here</div></div></div></div>`)); return; }
  items.forEach((it, i) => {
    const el = h(`<button class="card" style="animation-delay:${Math.min(i, 12) * 30}ms"><div class="media">${it.cover ? `<img src="${fileUrl(it.cover)}" alt="" loading="lazy">` : icon(it.icon)}</div><div class="cap"><span class="chip">${icon(it.icon)}</span><div style="min-width:0"><div class="ct">${esc(it.title)}</div><div class="cs">${esc(it.sub || it.kind)}</div></div></div></button>`);
    el.onclick = it.onclick; wrap.appendChild(el);
  });
}
let twTimer = null;
function startTypewriter() {
  const ed = $('#home-editor'); let i = 0;
  const step = (fn, ms) => { clearTimeout(twTimer); twTimer = setTimeout(fn, ms); };
  const run = () => {
    const text = PLACEHOLDERS[i % PLACEHOLDERS.length]; i++;
    const per = Math.max(30, Math.min(80, 2000 / text.length)); // the whole line lands in about two seconds
    let n = 0;
    const type = () => { n++; ed.dataset.tw = text.slice(0, n); if (n < text.length) step(type, per + Math.random() * 40 - 20); else step(erase, 1800); };
    const erase = () => { n--; ed.dataset.tw = text.slice(0, n); if (n > 0) step(erase, n === text.length - 1 ? 380 : 26); else step(run, 420); }; // a held backspace: one pause, then the key repeats
    type();
  };
  run();
}

// ---------------------------------------------------------------- composer
function wireComposer(which) {
  const ed = $(`#${which}-editor`), send = $(`#${which}-send`);
  ed.addEventListener('input', () => updateSend(which));
  ed.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!send.disabled) submit(which); } });
  send.onclick = () => { if (send.classList.contains('stop')) stopTurn(); else submit(which); };
  $(`#${which}-plus`).onclick = (e) => openPlusMenu(e.currentTarget, which);
  $(`#${which}-model`).onclick = (e) => openModelMenu(e.currentTarget);
  $(`#${which}-mode`).onclick = (e) => openModeMenu(e.currentTarget);
  $(`#${which}-provider`).onclick = (e) => openProviderMenu(e.currentTarget);
}
function updateSend(which) {
  const ed = $(`#${which}-editor`), send = $(`#${which}-send`);
  const working = which === 'chat' && S.chat?.working;
  if (working) { send.disabled = false; send.classList.add('stop'); send.innerHTML = '<span class="sq"></span>'; send.title = 'Stop'; return; }
  send.classList.remove('stop'); send.innerHTML = icon('send'); send.title = 'Send';
  send.disabled = !(ed.textContent.trim() || S.attachments[which].length);
  ed.classList.toggle('tw', which === 'home' && !ed.textContent);
}
function placeCaretEnd(el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
async function submit(which) {
  const ed = $(`#${which}-editor`);
  const text = ed.innerText.replace(/ /g, ' ').trim();
  const files = S.attachments[which].map((a) => a.path);
  if (!text && !files.length) return;
  let chat = S.chat;
  if (which === 'home' || !chat) { chat = await api('/api/chats', { method: 'POST', body: { model: S.config.model, effort: S.config.effort, mode: S.config.mode } }); S.chat = { ...chat, working: false }; S.expanded = new Set(); upsertChatRow(chat); location.hash = 'chat=' + chat.id; setView('chat'); $('#tb-title').textContent = chat.title; renderConversation(); }
  ed.textContent = ''; S.attachments[which] = []; renderAttach(which); updateSend(which);
  S.chat.working = true; updateSend('chat');
  wsSend({ t: 'send', chatId: S.chat.id, text, files });
}
async function stopTurn() { if (!S.chat) return; wsSend({ t: 'stop', chatId: S.chat.id }); }
function addFiles(files) { const which = S.view === 'home' ? 'home' : 'chat'; for (const f of files) uploadFile(f, which); }
async function uploadFile(file, which) {
  if (!S.chat && which === 'chat') which = 'home';
  const chatId = S.chat?.id || 'staging';
  const entry = { name: file.name, path: null, preview: /^image\//.test(file.type) ? URL.createObjectURL(file) : null, uploading: true };
  S.attachments[which].push(entry); renderAttach(which);
  try { const r = await fetch('/api/upload/' + chatId, { method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name), 'content-type': 'application/octet-stream' }, body: file }).then((r) => r.json()); entry.path = r.path; entry.name = r.name; entry.uploading = false; }
  catch (e) { toast('Upload failed: ' + e.message, true); S.attachments[which] = S.attachments[which].filter((a) => a !== entry); }
  renderAttach(which); updateSend(which);
}
function attachPath(path, name, which) { S.attachments[which].push({ name, path, preview: /\.(png|jpg|jpeg|webp|gif)$/i.test(path) ? fileUrl(path) : null }); renderAttach(which); updateSend(which); }
function renderAttach(which) {
  const row = $(`#${which}-attach`); row.innerHTML = ''; const list = S.attachments[which]; row.hidden = !list.length;
  list.forEach((a, i) => { const el = h(`<div class="attach" title="${esc(a.path || '')}">${a.preview ? `<img src="${a.preview}" alt="">` : `<span class="ico">${icon('viewed_skill')}</span>`}<span class="n">${esc(a.name)}${a.uploading ? '…' : ''}</span><button class="x" title="Remove">${icon('close_x')}</button></div>`); el.querySelector('.x').onclick = () => { list.splice(i, 1); renderAttach(which); updateSend(which); }; row.appendChild(el); });
}
function syncTriggers() {
  const model = S.chat?.model || S.config.model || 'default';
  const m = S.models.find((x) => x.value === model) || S.models[0] || { displayName: 'Auto' };
  const mode = S.chat?.mode || S.config.mode || 'ask';
  for (const w of ['home', 'chat']) {
    $(`#${w}-model .mtxt`).textContent = m.displayName;
    $(`#${w}-mode .mtxt`).textContent = mode === 'ask' ? 'Ask' : 'Auto';
    $(`#${w}-mode .lead`).innerHTML = icon(mode === 'ask' ? 'ask_hand' : 'generate_without_asking');
    $(`#${w}-mode`).title = mode === 'ask' ? 'Ask before generating' : 'Generate without asking';
    $(`#${w}-provider .mtxt`).textContent = PROV_NAME[curProvider()];
  }
  updateSend('home'); updateSend('chat');
}
async function setModel(value) { if (S.chat) { S.chat.model = value; await api('/api/chats/' + S.chat.id, { method: 'PATCH', body: { model: value } }); } S.config.model = value; await api('/api/settings', { method: 'POST', body: { model: value } }); syncTriggers(); }
async function setEffort(value) { if (S.chat) { S.chat.effort = value; await api('/api/chats/' + S.chat.id, { method: 'PATCH', body: { effort: value } }); } S.config.effort = value; await api('/api/settings', { method: 'POST', body: { effort: value } }); }
async function setMode(value) { if (S.chat) { S.chat.mode = value; await api('/api/chats/' + S.chat.id, { method: 'PATCH', body: { mode: value, alwaysAllowGen: false } }); } S.config.mode = value; await api('/api/settings', { method: 'POST', body: { mode: value } }); syncTriggers(); }

// Which provider renders. A chat keeps its own choice; on the home screen it sets the default priority.
async function setProvider(value) {
  if (S.chat) { S.chat.provider = value; await api('/api/chats/' + S.chat.id, { method: 'PATCH', body: { provider: value } }); }
  else { S.config.provider = value; await api('/api/settings', { method: 'POST', body: { provider: value } }); }
  syncTriggers(); refreshCredits();
  toast(`${S.chat ? 'This chat' : 'New chats'} will render with ${PROV_NAME[value]}`);
}
function openProviderMenu(anchor) {
  const cur = curProvider(); const cr = S.credits;
  const el = openMenu(anchor, 'ask prov-menu', IMAGE_PROVS.map(([v, n]) => { const has = Boolean(S.config.keys?.[v]); const st = providerStatus(v, cr); return `<button class="mrow" data-v="${v}" ${has ? '' : 'data-nokey="1"'}><span class="id"><span class="mi sm">${icon('h_credits_coin')}</span><span class="col"><span class="nm"><span>${n}</span></span><span class="ds${has && cr?.ok && cr.provider === v ? ' ok' : ''}">${has ? esc(st) : 'No key · add it in Settings'}</span></span></span><span class="right">${v === cur ? icon('check') : ''}</span></button>`; }).join(''));
  for (const b of $$('.mrow', el)) b.onclick = () => { closeMenu(); if (b.dataset.nokey) { openSettings(); return; } setProvider(b.dataset.v); };
}

// ---------------------------------------------------------------- menus (pop-in dropdowns)
function openMenu(anchor, cls, html, opts = {}) {
  closeMenu();
  const el = h(`<div class="menu ${cls}">${html}</div>`);
  document.body.appendChild(el); mountIcons(el);
  S.menu = { el, anchor, above: opts.above !== false, align: opts.align || 'left', at: opts.at || null };
  positionMenu(); anchor.classList.add('open');
  return el;
}
function positionMenu() {
  const { el, anchor, above, align, at } = S.menu; const w = el.offsetWidth, hgt = el.offsetHeight;
  if (at) { const left = Math.max(8, Math.min(at.x, innerWidth - w - 8)), top = Math.max(8, Math.min(at.y, innerHeight - hgt - 8)); el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.setProperty('--ox', '0%'); el.style.setProperty('--oy', '0%'); return; }
  const r = anchor.getBoundingClientRect();
  let left = align === 'right' ? r.right - w : r.left; left = Math.max(8, Math.min(left, innerWidth - w - 8));
  let top = above ? r.top - hgt - 8 : r.bottom + 8; if (top < 8) top = r.bottom + 8;
  el.style.left = left + 'px'; el.style.top = top + 'px';
  el.style.setProperty('--ox', align === 'right' ? '100%' : '0%'); el.style.setProperty('--oy', above ? '100%' : '0%');
}
// Search palette (Ctrl+K): filters chats, jobs and briefs as you type; Enter opens the highlighted row.
function openSearch() {
  const bg = $('#search'); bg.classList.add('on');
  const inp = $('#search-input'); inp.value = ''; inp.focus();
  let idx = 0;
  const rows = () => {
    const q = inp.value.trim().toLowerCase();
    const chats = S.chats.filter((c) => !q || c.title.toLowerCase().includes(q)).slice(0, 8).map((c) => ({ kind: 'Chat', title: c.title, icon: 'h_chats_chevron', go: () => openChat(c.id) }));
    const jobs = (S.jobs || []).filter((j) => q && j.name.toLowerCase().includes(q)).slice(0, 4).map((j) => ({ kind: 'Project', title: j.name, icon: 'project_folder', go: () => { S.cvJob = j.name; toggleCV(true); } }));
    const briefs = (S.briefs || []).filter((b) => q && b.name.toLowerCase().includes(q)).slice(0, 4).map((b) => ({ kind: 'Brief', title: b.name, icon: 'viewed_skill', go: () => openPage('briefs') }));
    return [...chats, ...jobs, ...briefs];
  };
  const render = () => {
    const list = rows(); idx = Math.min(idx, Math.max(0, list.length - 1));
    const el = $('#search-list'); el.innerHTML = list.length ? list.map((r, i) => `<button class="srow${i === idx ? ' sel' : ''}" data-i="${i}"><span class="ic">${icon(r.icon)}</span><span class="t">${esc(r.title)}</span><span class="k">${r.kind}</span></button>`).join('') : '<div class="sb-empty">Nothing matches</div>';
    mountIcons(el);
    for (const b of $$('.srow', el)) { b.onclick = () => { list[Number(b.dataset.i)].go(); close(); }; b.onmousemove = () => { idx = Number(b.dataset.i); for (const o of $$('.srow', el)) o.classList.toggle('sel', o === b); }; }
    el._list = list;
  };
  const close = () => { bg.classList.remove('on'); inp.onkeydown = null; inp.oninput = null; };
  inp.oninput = () => { idx = 0; render(); };
  inp.onkeydown = (e) => {
    const list = $('#search-list')._list || [];
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(list.length - 1, idx + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[idx]) { list[idx].go(); close(); } }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  bg.onclick = (e) => { if (e.target === bg) close(); };
  render();
}
function closeMenu() { if (!S.menu) return; const { el, anchor } = S.menu; anchor.classList.remove('open'); el.classList.add('closing'); setTimeout(() => el.remove(), 120); S.menu = null; }
function costClass(c) { return /low|included/i.test(c) ? 'low' : /medium/i.test(c) ? 'mid' : 'high'; }
function openModelMenu(anchor) {
  const cur = S.chat?.model || S.config.model || 'default'; const eff = S.chat?.effort || S.config.effort || 'medium';
  const rows = (filter = '') => S.models.filter((m) => !filter || (m.displayName + m.description).toLowerCase().includes(filter.toLowerCase())).map((m) => `<button class="mrow" data-v="${esc(m.value)}"><span class="id"><span class="mi">${CLAUDE_MARK}</span><span class="col"><span class="nm"><span>${esc(m.displayName)}</span>${m.tag ? `<span class="pill lime">${esc(m.tag)}</span>` : ''}</span><span class="ds">${esc(m.description)}</span></span></span><span class="right"><span class="cost ${costClass(m.cost)}">${icon('h_credits_coin')}<span>${esc(m.cost)}</span></span>${m.value === cur ? `<span class="chk hide-hover">${icon('check')}</span>` : ''}</span></button>`).join('');
  const el = openMenu(anchor, 'model', `<div class="search">${icon('search')}<input placeholder="Search models" id="model-search"></div><div class="lbl">Claude models</div><div class="list" id="model-list">${rows()}</div><div class="sep"></div><button class="mrow h56" id="effort-row"><span class="id"><span class="mi">${icon('usage')}</span><span class="col"><span class="nm"><span>${esc(EFFORTS.find((e) => e[0] === eff)?.[1] || 'Medium')} · Effort</span></span><span class="ds">How hard the model thinks per step</span></span></span><span class="right"><span class="rchev">${icon('chevron_row')}</span></span></button>`);
  const bind = () => { for (const b of $$('#model-list .mrow', el)) b.onclick = () => { setModel(b.dataset.v); closeMenu(); }; };
  bind();
  $('#model-search', el).oninput = (e) => { $('#model-list', el).innerHTML = rows(e.target.value); mountIcons($('#model-list', el)); bind(); };
  $('#effort-row', el).onclick = () => openEffortMenu(anchor);
  setTimeout(() => $('#model-search', el).focus(), 30);
}
function openEffortMenu(anchor) {
  const eff = S.chat?.effort || S.config.effort || 'medium';
  const el = openMenu(anchor, 'effort', `<div class="lbl">Effort</div>${EFFORTS.map(([v, n, d]) => `<button class="mrow" data-v="${v}"><span class="id"><span class="col"><span class="nm"><span>${n}</span></span><span class="ds">${d}</span></span></span><span class="right">${v === eff ? `<span class="chk">${icon('check')}</span>` : ''}</span></button>`).join('')}`);
  for (const b of $$('.mrow', el)) b.onclick = () => { setEffort(b.dataset.v); closeMenu(); toast(`Effort set to ${EFFORTS.find((e) => e[0] === b.dataset.v)[1]}`); };
}
function openModeMenu(anchor) {
  const mode = S.chat?.mode || S.config.mode || 'ask';
  const el = openMenu(anchor, 'ask', [['ask', 'ask_hand', 'Ask before generating', 'Every image or video render waits for your approval'], ['auto', 'generate_without_asking', 'Generate without asking', 'Renders run as soon as the pipeline asks for them']].map(([v, ic, n, d]) => `<button class="mrow" data-v="${v}"><span class="id"><span class="mi sm">${icon(ic)}</span><span class="col"><span class="nm"><span>${n}</span></span><span class="ds">${d}</span></span></span><span class="right">${v === mode ? `<span class="chk">${icon('check')}</span>` : ''}</span></button>`).join(''), { align: 'right' });
  for (const b of $$('.mrow', el)) b.onclick = () => { setMode(b.dataset.v); closeMenu(); };
}
function openPlusMenu(anchor, which) {
  const briefs = S.briefs.slice(0, 6).map((b) => `<button class="mrow" data-brief="${esc(b.path)}" data-name="${esc(b.name)}"><span class="id"><span class="mi sm">${icon('viewed_skill')}</span><span class="col"><span class="nm"><span>${esc(b.name)}</span></span><span class="ds">Attach this brief</span></span></span></button>`).join('');
  const el = openMenu(anchor, 'plus', `<button class="mrow" id="pm-upload"><span class="id"><span class="mi sm">${icon('plus')}</span><span class="col"><span class="nm"><span>Upload files</span></span><span class="ds">Images, videos, briefs, references</span></span></span></button>${briefs ? `<div class="sep"></div><div class="lbl" style="padding-top:6px">Briefs</div>${briefs}` : ''}`);
  $('#pm-upload', el).onclick = () => { closeMenu(); $('#file-input').click(); };
  for (const b of $$('[data-brief]', el)) b.onclick = () => { attachPath(b.dataset.brief, b.dataset.name, which); closeMenu(); };
}
function openJobMenu(anchor) {
  const el = openMenu(anchor, 'small', `<button class="mrow" data-j=""><span class="id"><span class="col"><span class="nm"><span>Chat History</span></span></span></span>${!S.cvJob ? `<span class="chk">${icon('check')}</span>` : ''}</button>${S.jobs.map((j) => `<button class="mrow" data-j="${esc(j.name)}"><span class="id"><span class="col"><span class="nm"><span>${esc(j.name)}</span></span><span class="ds">${j.count} files</span></span></span>${S.cvJob === j.name ? `<span class="chk">${icon('check')}</span>` : ''}</button>`).join('')}`, { above: false });
  for (const b of $$('.mrow', el)) b.onclick = () => { S.cvJob = b.dataset.j || null; closeMenu(); renderCV(); };
}

// ---------------------------------------------------------------- websocket
function connectWS() {
  // One socket, ever. A second live socket would replay every server event once per socket (duplicate bubbles, doubled text).
  if (S.ws && (S.ws.readyState === WebSocket.OPEN || S.ws.readyState === WebSocket.CONNECTING)) return;
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  S.ws = ws;
  ws.onopen = () => { S.wsReady = true; };
  ws.onclose = () => { S.wsReady = false; setTimeout(connectWS, 1500); };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onEvent(m); };
}
function wsSend(obj) { if (!S.wsReady) { toast('Not connected to the server yet.', true); return; } S.ws.send(JSON.stringify(obj)); }
function onEvent(m) {
  if (m.t === 'hello') { if (S.build && S.build !== m.build) { toast('Supercomputer updated, reloading'); setTimeout(() => location.reload(), 600); } S.build = m.build; return; }
  if (m.t === 'models') { S.models = m.models; syncTriggers(); return; }
  if (m.t === 'error') { toast(m.error, true); if (S.chat && m.chatId === S.chat.id && m.error === 'busy') return; }
  if (m.t === 'log') return;
  const mine = S.chat && m.chatId === S.chat.id;
  switch (m.t) {
    case 'user': { if (mine) { S.chat.messages.push(m.message); S.chat.title = m.title; $('#tb-title').textContent = m.title; appendMessage(m.message); scrollBottom(true); } upsertChatRow({ id: m.chatId, title: m.title, working: true }); break; }
    case 'title': { if (mine) { S.chat.title = m.title; $('#tb-title').textContent = m.title; } upsertChatRow({ id: m.chatId, title: m.title }); break; }
    case 'turn_start': { if (mine) { const turn = { id: m.turn.id, role: 'assistant', ts: m.turn.ts, status: 'working', blocks: [] }; S.chat.messages.push(turn); S.chat.working = true; S.expanded.add(turn.id); appendMessage(turn); startTimer(); updateSend('chat'); scrollBottom(true); } break; }
    case 'block': { if (!mine) break; const turn = S.chat.messages.find((x) => x.id === m.turnId); if (!turn) break; turn.blocks.push(m.block); renderBlock(turn, m.block); scrollBottom(); if (m.block.kind === 'image') { if (!S.cvOpen && !S.cvDismissed && S.config.cvAuto !== false && !S.cvJob) toggleCV(true); else if (S.cvOpen && !S.cvJob) renderCV(); } break; }
    case 'update': { if (!mine) break; const turn = S.chat.messages.find((x) => x.id === m.turnId); const b = turn?.blocks.find((x) => x.id === m.blockId); if (!b) break; Object.assign(b, m.patch); renderBlock(turn, b); if (b.kind === 'image' && S.cvOpen && !S.cvJob) renderCV(); if (b.kind === 'refs') { if (S.refsSel) delete S.refsSel[b.id]; if (S.cvOpen && !S.cvJob) { if (S.cvMode === 'refs') renderCV(); else renderCVModes(); } } break; }
    case 'think': { if (!mine) break; const turn = S.chat.messages.find((x) => x.id === m.turnId); const b = turn?.blocks.find((x) => x.id === m.blockId); if (!b) break; b.detail = (b.detail || '') + m.text; appendThink(turn, b, m.text); break; }
    case 'delta': { if (!mine) break; const turn = S.chat.messages.find((x) => x.id === m.turnId); const b = turn?.blocks.find((x) => x.id === m.blockId); if (!b) break; b.text += m.text; appendDelta(b, m.text); scrollBottom(); break; }
    case 'ask': { if (mine) enqueueRequest('ask', m); upsertChatRow({ id: m.chatId, needs: 'ask', working: true }); break; }
    case 'scout_state': { if (!mine) break; const fresh = m.phase === 'searching' && S.scout?.query !== m.query; S.scout = { ...(fresh ? {} : (S.scout || {})), ...m, items: fresh ? [] : (S.scout?.items || []) }; if (m.phase !== 'searching') S.cvPick = false; if (m.phase === 'searching' && !S.cvPick && (!S.cvOpen || S.cvMode !== 'browser')) { S.cvMode = 'browser'; S.cvJob = null; toggleCV(true); } else if (S.cvOpen && S.cvMode !== 'browser') renderCV(); break; } // cvPick: the user chose a tab during this search, so the browser never pulls them back
    case 'scout_found': { if (!mine) break; S.scout = { ...(S.scout || {}), found: m.found, need: m.need, items: [...(S.scout?.items || []), m.item] }; break; }
    case 'bro_open': { if (!mine) break; S.bro.open = true; S.bro.error = ''; S.bro.w = m.w; S.bro.h = m.h; if (S.cvOpen && S.cvMode === 'browser') renderBrowserView(); break; }
    case 'bro_frame': { if (!mine) break; S.bro.frame = m.jpeg; if (m.w) { S.bro.w = m.w; S.bro.h = m.h; } if (!S.bro.open) S.bro.open = true; const im = $('#bro-img'); if (im) im.src = 'data:image/jpeg;base64,' + m.jpeg; else if (S.cvOpen && S.cvMode === 'browser') renderBrowserView(); break; }
    case 'bro_nav': { if (!mine) break; S.bro.open = true; S.bro.url = m.url || ''; S.bro.title = m.title || ''; if (m.w) { S.bro.w = m.w; S.bro.h = m.h; } const u = $('#bro-url'); if (u && document.activeElement !== u) u.value = S.bro.url === 'about:blank' ? '' : S.bro.url; break; }
    case 'bro_closed': { if (!mine) break; S.bro = { ...S.bro, open: false, frame: null, url: '', title: '', pick: false, box: null }; if (S.cvOpen && S.cvMode === 'browser') renderBrowserView(); break; }
    case 'bro_error': { if (!mine) break; toast(m.message || 'The browser could not do that.', true); if (!S.bro.frame) { S.bro.open = false; S.bro.error = m.message || 'The browser could not open.'; if (S.cvOpen && S.cvMode === 'browser') renderBrowserView(); } break; }
    case 'bro_picked': { if (!mine) break; if (m.item) { const blk = allRefs().filter((b) => b.picked && b.status === 'open').pop(); toast(`Saved as reference ${m.item.n}`, false, blk ? { label: 'Undo', fn: () => removeRef(blk, m.item.n) } : null); renderCVModes(); if (S.cvOpen && S.cvMode === 'refs') renderRefsView(); } else toast('No picture there. Click right on a picture.', true); break; }
    case 'code': { if (!mine) break; const turn = S.chat.messages.find((x) => x.id === m.turnId); const b = turn?.blocks.find((x) => x.id === m.blockId); if (!b) break; b.code = (b.code || '') + m.text; appendCode(turn, b, m.text); scrollBottom(); break; }
    case 'bl_open': { if (!mine) break; S.bl.open = true; S.bl.opening = false; S.bl.error = ''; S.bl.file = m.file || ''; S.bl.embed = m.embed !== false; S.bl.version = m.version || ''; if (S.cvOpen) { renderCVModes(); if (S.cvMode === 'blender') renderBlenderView(); } blLastKey = ''; break; }
    case 'bl_placed': { if (!mine) break; S.bl.placed = { x: m.x, y: m.y, w: m.w, h: m.h }; break; }
    case 'bl_frame': { if (!mine) break; S.bl.frame = m.jpeg || m.png; S.bl.kind = m.jpeg ? 'jpeg' : 'png'; if (m.w) { S.bl.w = m.w; S.bl.h = m.h; } if (!S.bl.open) { S.bl.open = true; S.bl.opening = false; S.bl.embed = false; } const im = $('#bl-img'); if (im) im.src = `data:image/${S.bl.kind};base64,` + S.bl.frame; else if (S.cvOpen && S.cvMode === 'blender') renderBlenderView(); break; }
    case 'bl_state': { if (!mine) break; S.bl.state = m; if (m.file) S.bl.file = m.file; updateBlTransport(); break; }
    case 'bl_closed': { if (!mine) break; S.bl = { ...S.bl, open: false, opening: false, frame: null, state: null, placed: null }; blLastKey = ''; if (m.why) toast(m.why); if (S.cvOpen) { renderCVModes(); if (S.cvMode === 'blender') renderBlenderView(); } break; }
    case 'bl_error': { if (!mine) break; if (m.fatal) { S.bl.open = false; S.bl.opening = false; S.bl.error = m.message || 'Blender could not open.'; if (S.cvOpen && S.cvMode === 'blender') renderBlenderView(); } toast(m.message || 'Blender could not do that.', true); break; }
    case 'previz_done': { if (!mine) break; toast('Blender clip rendered' + (S.bl.open ? ' · Blender reloaded the scene' : '')); break; }
    case 'refs_request': { if (!mine) break; if (S.refsSel) delete S.refsSel[m.blockId]; S.cvMode = 'refs'; S.cvJob = null; toggleCV(true); break; }
    case 'approve_request': { if (mine) enqueueRequest('approve', m); upsertChatRow({ id: m.chatId, needs: 'approve', working: true }); break; }
    case 'job': { if (mine) { S.chat.job = m.job; updateProgress(); if (S.cvOpen && S.cvJob) renderCV(); } loadHome(); break; }
    case 'turn_end': { if (mine) { const turn = S.chat.messages.find((x) => x.id === m.turnId); if (turn) { turn.status = m.status; turn.durationMs = m.durationMs; turn.cost = m.cost; } S.chat.working = false; S.expanded.delete(m.turnId); if (!m.needs) { S.ask = null; S.approve = null; S.queue = []; hidePanel(); } stopTimer(); if (turn) renderTurnHeader(turn); updateSend('chat'); updateProgress(); } upsertChatRow({ id: m.chatId, working: false, needs: m.needs || null }); refreshCredits(); loadHome(); break; }
  }
}

// ---------------------------------------------------------------- conversation rendering
function renderConversation() { const col = $('#chat-col'); col.innerHTML = ''; for (const msg of S.chat.messages) appendMessage(msg); const last = S.chat.messages[S.chat.messages.length - 1]; if (last?.role === 'assistant' && last.status === 'working') { S.expanded.add(last.id); startTimer(); } updateSend('chat'); }
function fmtTime(ts) { const d = new Date(ts); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtDur(ms) { const s = Math.max(0, Math.round(ms / 1000)); if (s < 60) return `${s}s`; const m = Math.floor(s / 60); const r = s % 60; if (m < 60) return `${m}m ${r}s`; return `${Math.floor(m / 60)}h ${m % 60}m`; }
function appendMessage(msg) {
  const col = $('#chat-col');
  if (msg.role === 'user') {
    const files = (msg.files || []).map((p) => /\.(png|jpg|jpeg|webp|gif)$/i.test(p) ? `<img src="${fileUrl(p)}" alt="" title="${esc(p)}">` : `<div class="f" title="${esc(p)}">${icon('viewed_skill')}<span>${esc(p.split(/[\\/]/).pop())}</span></div>`).join('');
    const el = h(`<div class="msg-user" data-id="${msg.id}">${files ? `<div class="bubble-files">${files}</div>` : ''}${(msg.display || msg.text) ? `<div class="bubble">${esc(msg.display || msg.text)}</div>` : ''}<div class="hover-row"><button title="Copy">${icon('copy')}</button><button title="Edit">${icon('edit')}</button><time>${fmtTime(msg.ts)}</time></div></div>`);
    el.querySelector('[title=Copy]').onclick = () => { navigator.clipboard.writeText(msg.text || ''); toast('Copied'); };
    el.querySelector('[title=Edit]').onclick = () => { $('#chat-editor').textContent = msg.text || ''; placeCaretEnd($('#chat-editor')); updateSend('chat'); };
    for (const img of el.querySelectorAll('img')) img.onclick = () => lightbox(img.src, img.title);
    col.appendChild(el); return;
  }
  const el = h(`<div class="msg-assistant" data-id="${msg.id}"><div class="work-head"><button class="wh-btn"><span class="brand-mark ghost"></span><span class="chev" hidden>${icon('chevron_row')}</span><span class="wh-txt"></span></button></div><div class="steps-wrap"><div><div class="steps"></div></div></div><div class="out"></div><div class="hover-row" hidden><button title="Copy">${icon('copy')}</button><time>${fmtTime(msg.ts)}</time></div></div>`);
  el.querySelector('.brand-mark').innerHTML = LOGO;
  el.querySelector('.wh-btn').onclick = () => { if (msg.status === 'working') return; if (S.expanded.has(msg.id)) S.expanded.delete(msg.id); else S.expanded.add(msg.id); renderTurnHeader(msg); };
  el.querySelector('[title=Copy]').onclick = () => { navigator.clipboard.writeText(msg.blocks.filter((b) => b.kind === 'text').map((b) => b.text).join('\n\n')); toast('Copied'); };
  col.appendChild(el);
  for (const b of msg.blocks) renderBlock(msg, b);
  renderTurnHeader(msg);
}
function renderTurnHeader(turn) {
  const el = $(`.msg-assistant[data-id="${turn.id}"]`); if (!el) return;
  const head = el.querySelector('.work-head'), txt = el.querySelector('.wh-txt'), chev = el.querySelector('.chev'), mark = el.querySelector('.brand-mark');
  const open = S.expanded.has(turn.id) || turn.status === 'working';
  const waiting = turn.status === 'working' && (S.ask || S.approve);
  head.className = 'work-head' + (turn.status === 'working' ? (waiting ? ' wait' : ' live') : '') + (open ? ' open' : '');
  if (turn.status === 'working') { mark.hidden = false; chev.hidden = true; txt.textContent = waiting ? (S.ask ? 'Waiting for your reply' : 'Waiting for your approval') : `Working for ${fmtDur(Date.now() - turn.ts)}`; }
  else { mark.hidden = true; chev.hidden = false; txt.textContent = turn.status === 'stopped' ? `Stopped after ${fmtDur(turn.durationMs)}` : turn.status === 'error' ? `Failed after ${fmtDur(turn.durationMs)}` : `Worked for ${fmtDur(turn.durationMs)}`; }
  el.querySelector('.steps-wrap').classList.toggle('open', open);
  el.querySelector('.hover-row').hidden = turn.status === 'working';
  const hasSteps = turn.blocks.some((b) => b.kind === 'step' || b.kind === 'question');
  el.querySelector('.wh-btn').disabled = !hasSteps && turn.status !== 'working';
}
function startTimer() { stopTimer(); S.timer = setInterval(() => { const t = S.chat?.messages.find((m) => m.role === 'assistant' && m.status === 'working'); if (t) renderTurnHeader(t); }, 1000); }
function stopTimer() { clearInterval(S.timer); S.timer = null; }

function renderBlock(turn, b) {
  const wrap = $(`.msg-assistant[data-id="${turn.id}"]`); if (!wrap) return;
  const steps = wrap.querySelector('.steps'), out = wrap.querySelector('.out');
  let el = wrap.querySelector(`[data-bid="${b.id}"]`);
  const put = (parent, node) => { if (el) el.replaceWith(node); else parent.appendChild(node); mountIcons(node); };
  switch (b.kind) {
    case 'code': {
      // A script the agent is writing: the file name on top, the code below as it streams (an Edit shows the old lines
      // in red above the new ones in green). Click the head to fold it.
      const open = !S.folded?.has(b.id);
      const title = b.streaming ? (b.edit ? 'Editing' : 'Writing') : (b.edit ? 'Edited' : 'Wrote');
      const node = h(`<div data-bid="${b.id}" class="codeblk${b.streaming ? ' live' : ''}${b.status === 'error' ? ' err' : ''}${open ? ' open' : ''}"><div class="cb-head">${icon('edit')}<span class="lbl">${title} <b>${esc(b.name || 'script')}</b></span><span class="sub">${esc(b.rel || '')}</span><span class="rchev">${icon('chevron_row')}</span></div><div class="cb-body"><div>${b.edit && b.old ? `<pre class="code old">${esc(b.old).split('\n').map((l) => `<span class="ln del">${l}</span>`).join('\n')}</pre>` : ''}<pre class="code${b.edit ? ' new' : ''}">${esc(b.code || '')}</pre></div></div></div>`);
      node.querySelector('.cb-head').onclick = () => { S.folded ||= new Set(); if (S.folded.has(b.id)) S.folded.delete(b.id); else S.folded.add(b.id); renderBlock(turn, b); };
      if (b.streaming) requestAnimationFrame(() => { const p = node.querySelector('pre.code:not(.old)'); if (p) p.scrollTop = p.scrollHeight; });
      put(steps, node); break;
    }
    case 'step': {
      const liveThink = b.thinking && b.status === 'live';
      const open = S.expanded.has(b.id) || (liveThink && !S.collapsedThink?.has(b.id));
      const cls = ['step', b.status === 'live' ? 'live' : '', b.gen ? 'gen' : '', b.thinking ? 'think' : '', b.warn ? 'warn' : '', b.status === 'error' ? 'err' : '', open ? 'open' : ''].filter(Boolean).join(' ');
      const hasDetail = Boolean(b.detail) || liveThink;
      const detail = b.thinking ? `<div class="think">${esc(b.detail || '')}</div>` : `<pre>${esc(b.detail || '')}</pre>`;
      const model = b.video ? videoLabel(b.params) : /browser_video/.test(b.command || '') ? 'Seedance / Kling' : modelName(b.provider);
      const node = h(`<div data-bid="${b.id}"><div class="${cls}"><span class="ic">${icon(b.icon)}</span><span class="lbl">${esc(blenderName(b.label))}</span>${b.sub && !/^(cd|Set-Location|pushd)/.test(b.sub) ? `<span class="sub">${esc(blenderName(b.sub))}</span>` : '<span class="sub"></span>'}${b.count ? `<span class="cnt">${b.count} step${b.count === 1 ? '' : 's'}</span>` : ''}${hasDetail ? `<span class="rchev">${icon('chevron_row')}</span>` : ''}</div>${hasDetail ? `<div class="step-detail${open ? ' open' : ''}"><div>${detail}</div></div>` : ''}${b.awaiting ? `<div class="gen-tree"><div class="gen-prompt">${esc(b.prompt || genSummary(b))}</div><div class="chips"><span class="mchip sm">${icon('generation')}<span>${model}</span></span>${b.credits ? `<span class="gen-credits">${icon('h_credits_coin')}${b.credits.toLocaleString()} credits</span>` : b.usd ? `<span class="gen-credits">${icon('h_credits_coin')}$${b.usd}</span>` : b.provider && b.provider !== 'elevenlabs' ? `<span class="gen-credits">${icon('h_credits_coin')}${PROV_NAME[b.provider]}</span>` : ''}</div></div>` : ''}</div>`);
      if (hasDetail) node.querySelector('.step').onclick = () => { if (open) { S.expanded.delete(b.id); if (liveThink) (S.collapsedThink ||= new Set()).add(b.id); } else { S.expanded.add(b.id); S.collapsedThink?.delete(b.id); } renderBlock(turn, b); };
      if (liveThink && open) requestAnimationFrame(() => { const t = node.querySelector('.think'); if (t) t.scrollTop = t.scrollHeight; });
      put(steps, node); break;
    }
    case 'question': {
      const n = b.questions.length;
      const body = b.questions.map((q) => { const a = b.answers?.[q.question]; return `<div class="q">${esc(q.question)}</div><div class="a${b.status === 'skipped' ? ' skipped' : ''}">${esc(b.status === 'skipped' ? 'Skipped' : a || (b.status === 'open' ? 'Waiting…' : ''))}</div>`; }).join('<div style="height:12px"></div>');
      const node = h(`<div data-bid="${b.id}" class="qcard"><div class="qh">${icon('answer')}<span>${n} ${n === 1 ? 'answer' : 'answers'}</span></div><div class="div"></div>${body}</div>`);
      put(steps, node); break;
    }
    case 'refs': {
      const hiddenPicks = (x) => x.kind === 'refs' && x.picked && !(x.items || []).length;
      wrap.hidden = turn.blocks.every(hiddenPicks);
      if (hiddenPicks(b)) { put(out, h(`<div data-bid="${b.id}" hidden></div>`)); break; }
      const kept = (b.items || []).filter((i) => i.keep !== false).length; const n = (b.items || []).length;
      const sub = b.status === 'searching' ? 'Looking on Pinterest, Pexels and Google Images…' : b.status === 'open' ? `${n} found · review them in the side panel` : b.status === 'decided' ? (b.decision === 'approve' ? `Approved ${kept} of ${n}` : `Kept ${kept}, looking for more`) : b.status === 'empty' ? 'Nothing usable found' : (b.error || 'Could not browse');
      const node = h(`<div data-bid="${b.id}" class="refcard${b.status === 'searching' ? ' glow-ring' : ''}${b.status === 'open' ? ' open' : ''}"><div class="rc-head">${icon('explored')}<div class="rc-txt"><b>${esc(b.label ? `References for ${b.label}` : 'References')}</b><span>${esc(sub)}</span></div><button class="btn ${b.status === 'open' ? 'lime' : 'ghost'} sm rc-open">${b.status === 'searching' ? 'Watch' : b.status === 'open' ? 'Review' : 'Open'}</button></div>${n ? `<div class="rc-strip">${(b.items || []).map((i) => `<img src="${fileUrl(i.path)}" class="${i.keep === false ? 'drop' : ''}" alt="">`).join('')}</div>` : ''}</div>`);
      node.querySelector('.rc-open').onclick = () => { S.cvMode = b.status === 'searching' ? 'browser' : 'refs'; S.cvJob = null; toggleCV(true); };
      put(out, node); break;
    }
    case 'text': {
      const node = h(`<div data-bid="${b.id}" class="text-block${b.streaming ? ' streaming' : ''}"></div>`);
      if (b.streaming) node.innerHTML = `<p>${esc(b.text)}</p>`; else node.innerHTML = md(b.text);
      wireText(node);
      put(out, node); break;
    }
    case 'image': {
      // consecutive generations share a row (the source lays tiles out side by side under the answer)
      const row = (el && el.parentElement?.classList.contains('gen-row')) ? el.parentElement : (out.lastElementChild?.classList.contains('gen-row') ? out.lastElementChild : (() => { const r = h('<div class="gen-row"></div>'); out.appendChild(r); return r; })());
      if (!b.path) {
        const st = b.status === 'failed' ? 'failed' : b.status === 'processing' ? 'processing' : 'queued';
        const pill = st === 'failed' ? `<span class="pill-state warn">${icon('warning')}${b.error === 'Stopped' ? 'Stopped' : 'Failed'}</span>` : `<span class="pill-state">${b.waiting ? icon('ask_hand') : '<span class="spin"></span>'}${b.waiting ? 'Awaiting approval' : st === 'processing' ? 'Processing' : 'Queued'}</span>`;
        const prog = b.preview && st !== 'failed' ? `<img class="prog" src="${fileUrl(b.preview)}&t=${b.previewAt || 0}" alt="">` : '';
        const pill2 = prog ? `<span class="pill-state"><span class="spin"></span>Rendering</span>` : pill;
        const node = h(`<div data-bid="${b.id}" class="imgcard tile ${st}${b.video ? ' vid' : ''}${prog ? ' has-prog' : ''}" title="${esc(b.item || '')}">${prog}${pill2}${st === 'failed' ? `<div class="err">${esc(b.error || 'Failed')}</div>` : ''}</div>`);
        put(row, node); break;
      }
      const label = b.item ? `${b.item}${b.version ? ' · ' + b.version : ''}` : b.path.split(/[\\/]/).pop();
      if (b.video) { put(row, videoCard(turn, b, label)); break; }
      const media = b.video ? `<video src="${fileUrl(b.path)}" controls muted playsinline></video>` : `<img src="${fileUrl(b.path)}" alt="${esc(label)}">`;
      const verdict = b.decision === 'approve' ? `<span class="verdict ok">${icon('check')}Approved</span>` : b.decision === 'reject' ? `<span class="verdict no">${icon('edit')}Feedback sent</span>` : '';
      const acts = b.decision ? verdict : (b.status === 'gate' || b.status === 'generated') ? `<button class="btn ghost" data-act="reject">${icon('edit')}Disapprove</button><button class="btn lime" data-act="approve">${icon('check')}Approve</button>` : '';
      const node = h(`<div data-bid="${b.id}" class="imgcard done${b.decision ? ' decided' : ''}"><div class="frame">${media}${b.decision === 'approve' ? `<span class="pill-state ok">${icon('check')}Approved</span>` : b.decision === 'reject' ? `<span class="pill-state">${icon('edit')}Feedback sent</span>` : ''}</div><div class="meta"><div class="grow"><div class="mt" title="${esc(label)}">${esc(label)}</div></div><div class="acts">${b.decision ? '' : (b.status === 'gate' || b.status === 'generated') ? `<button class="ib" data-act="reject" title="Disapprove">${icon('edit')}</button><button class="ib lime" data-act="approve" title="Approve">${icon('check')}</button>` : ''}<button class="ib open-folder" title="Open folder">${icon('popout')}</button></div></div><div class="fb"><input placeholder="What should change?" maxlength="600"><button class="btn lime sm">Send</button></div></div>`);
      const frame = node.querySelector('.frame');
      if (!b.video) frame.onclick = () => lightbox(fileUrl(b.path), b.path);
      else { const x = h(`<button class="ib expand" title="Play full screen">${icon('popout')}</button>`); frame.appendChild(x); x.onclick = (e) => { e.stopPropagation(); const v = frame.querySelector('video'); if (v) v.pause(); lightbox(fileUrl(b.path), b.path); }; }
      node.querySelector('.open-folder').onclick = () => api('/api/open-folder', { method: 'POST', body: { path: b.path } }).catch(() => {});
      const ap = node.querySelector('[data-act=approve]'), rj = node.querySelector('[data-act=reject]');
      if (ap) ap.onclick = () => imageDecision(turn, b, 'approve');
      if (rj) rj.onclick = () => { node.classList.toggle('fb-open'); node.querySelector('.fb input').focus(); };
      const inp = node.querySelector('.fb input'), sendB = node.querySelector('.fb .btn');
      const sendFb = () => { const t = inp.value.trim(); if (!t) return; imageDecision(turn, b, 'reject', t); };
      sendB.onclick = sendFb; inp.onkeydown = (e) => { if (e.key === 'Enter') sendFb(); };
      put(row, node); break;
    }
    case 'approval': {
      // Items that already have a Generation step row are shown there; only agent-internal ones get a row here.
      const orphans = b.items.filter((i) => !i.hasStep);
      const node = h(`<div data-bid="${b.id}"${orphans.length ? '' : ' hidden'}>${orphans.map((i) => `<div class="step ${b.status === 'open' ? 'live gen' : b.decision === 'stop' ? 'err' : ''}"><span class="ic">${icon('generation')}</span><span class="lbl">${i.video ? 'Video generation' : 'Generation'}</span><span class="sub">${b.status === 'open' ? (i.video ? 'Approve video?' : 'Approve image?') : b.decision === 'stop' ? 'Rejected' : 'Preparing'}</span></div>${b.status === 'open' ? `<div class="gen-tree"><div class="gen-prompt">${esc(i.prompt || genSummary(i))}</div><span class="mchip sm">${icon('generation')}<span>${i.video ? videoLabel(i.params) : 'GPT Image 2'}</span></span></div>` : ''}`).join('')}</div>`);
      put(steps, node); break;
    }
  }
}
function appendCode(turn, b, text) {
  const node = $(`[data-bid="${b.id}"]`); const p = node?.querySelector('pre.code:not(.old)');
  if (!p) { renderBlock(turn, b); return; }
  p.appendChild(document.createTextNode(text)); p.scrollTop = p.scrollHeight;
}
function appendThink(turn, b, text) {
  const node = $(`[data-bid="${b.id}"]`); const t = node?.querySelector('.think');
  if (!t) { renderBlock(turn, b); return; }
  t.appendChild(document.createTextNode(text)); t.scrollTop = t.scrollHeight;
}
function appendDelta(b, text) {
  const node = $(`[data-bid="${b.id}"]`); if (!node) return;
  let p = node.querySelector('p:last-child'); if (!p) { p = document.createElement('p'); node.appendChild(p); }
  const parts = text.split(/\n{2,}/);
  parts.forEach((part, i) => { if (i > 0) { p = document.createElement('p'); node.appendChild(p); } if (!part) return; const span = document.createElement('span'); span.className = 'sd'; span.textContent = part; p.appendChild(span); });
}
// A rendered clip, laid out like the Supercomputer's video card: the frame with a play button, the hover icons that drop
// in from above (add to the chat, download, full screen), the caption under it, then the type chip, the model, copy,
// the time, and the approve / disapprove pair while a decision is open.
function videoCard(turn, b, label) {
  const step = (turn.blocks || []).find((x) => x.id === b.stepId) || null;
  const caption = ((step?.prompt || '').trim().split('\n')[0] || label).replace(/^Previz:/i, 'Blender:');   // the clip is called Blender in the app; older scripts say Previz
  const kind = b.previz ? 'Blender' : 'Video';
  const open = !b.decision && (b.status === 'gate' || b.status === 'generated');
  const pill = b.decision === 'approve' ? `<span class="pill-state ok">${icon('check')}Approved</span>` : b.decision === 'reject' ? `<span class="pill-state">${icon('edit')}Feedback sent</span>` : '';
  const right = open ? `<div class="vhover right"><button class="vi" data-act="reject" title="Disapprove">${icon('edit')}</button><button class="vi ok" data-act="approve" title="Approve">${icon('check')}</button></div>` : pill;
  const node = h(`<div data-bid="${b.id}" class="imgcard done vidcard${b.decision ? ' decided' : ''}">
    <div class="vframe" tabindex="0"><video src="${fileUrl(b.path)}" muted playsinline preload="metadata"></video><button class="vplay" title="Play">${VC_SVG.play}</button>
      <div class="vhover left"><button class="vi" data-v="add" title="Add to the chat">${VC_SVG.plus}</button><button class="vi" data-v="dl" title="Download">${VC_SVG.down}</button>${b.previz ? `<button class="vi" data-v="blender" title="Open in Blender"><img class="vi-logo" src="logos/blender.svg" alt=""></button>` : ''}<button class="vi" data-v="full" title="Full screen">${VC_SVG.full}</button></div>${right}
      <div class="vmeta"><div class="vcap" title="${esc(caption)}">${esc(caption)}</div><span class="vtag">${kind}</span></div></div>
    <div class="vrow"><span class="vchip">${VC_SVG.wave}<span>${kind}</span></span><button class="ib sm vcopy" title="Copy the path">${icon('copy')}</button><span class="vtime">${fmtClock(b.ts || Date.now())}</span></div>
    <div class="fb"><input placeholder="What should change?" maxlength="600"><button class="btn lime sm">Send</button></div></div>`);
  const frame = node.querySelector('.vframe'), v = frame.querySelector('video'), play = frame.querySelector('.vplay');
  const toggle = () => { if (v.paused) v.play().catch(() => {}); else v.pause(); };
  play.onclick = (e) => { e.stopPropagation(); toggle(); };
  v.onclick = toggle;
  v.onplay = () => frame.classList.add('playing'); v.onpause = () => frame.classList.remove('playing'); v.onended = () => { frame.classList.remove('playing'); v.currentTime = 0; };
  node.querySelector('[data-v=full]').onclick = (e) => { e.stopPropagation(); v.pause(); lightbox(fileUrl(b.path), b.path); };
  const blBtn = node.querySelector('[data-v=blender]'); if (blBtn) blBtn.onclick = (e) => { e.stopPropagation(); v.pause(); blOpenScene(b.path.replace(/\.mp4$/i, '.blend')); };
  node.querySelector('[data-v=dl]').onclick = (e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = fileUrl(b.path); a.download = b.path.split(/[\\/]/).pop(); document.body.appendChild(a); a.click(); a.remove(); };
  node.querySelector('[data-v=add]').onclick = (e) => { e.stopPropagation(); attachPath(b.path, b.path.split(/[\\/]/).pop(), 'chat'); toast('Added to the chat'); $('#chat-editor')?.focus(); };
  node.querySelector('.vcopy').onclick = () => { navigator.clipboard.writeText(b.path); toast('Path copied'); };
  const ap = node.querySelector('[data-act=approve]'), rj = node.querySelector('[data-act=reject]');
  if (ap) ap.onclick = (e) => { e.stopPropagation(); imageDecision(turn, b, 'approve'); };
  if (rj) rj.onclick = (e) => { e.stopPropagation(); node.classList.toggle('fb-open'); node.querySelector('.fb input').focus(); };
  const inp = node.querySelector('.fb input'), sendB = node.querySelector('.fb .btn');
  const sendFb = () => { const t = inp.value.trim(); if (!t) return; imageDecision(turn, b, 'reject', t); };
  sendB.onclick = sendFb; inp.onkeydown = (e) => { if (e.key === 'Enter') sendFb(); };
  return node;
}
// Older chats were saved when the Blender clip was still called a previz; they read as Blender now.
function blenderName(t) { return String(t || '').replace(/^Motion previz$/, 'Blender render').replace(/^Previz check$/, 'Blender check').replace(/^Approve previz\?$/, 'Approve Blender clip?'); }
function fmtClock(ts) { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
const VC_SVG = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12m0 0 5-5m-5 5-5-5M4 20h16"/></svg>',
  full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  wave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h2l2-6 3 12 3-9 2 6 2-3h4"/></svg>',
};
function imageDecision(turn, b, decision, feedback) {
  if (!S.chat) return; if (S.chat.working) { toast('Wait for the current step to finish, then decide.', true); return; }
  b.decision = decision; renderBlock(turn, b);
  const label = b.item ? `${b.item}${b.version ? ' ' + b.version : ''}` : b.path.split(/[\\/]/).pop();
  const text = decision === 'approve' ? `approve ${label}` : `${label}: ${feedback}`;
  S.chat.working = true; updateSend('chat');
  wsSend({ t: 'send', chatId: S.chat.id, text, files: [] });
}
function scrollBottom(force) { const sc = $('#chat-scroll'); if (force || S.atBottom) requestAnimationFrame(() => { sc.scrollTop = sc.scrollHeight; }); }
function updateProgress() {
  const el = $('#tb-progress'); if (!S.chat) { el.hidden = true; return; }
  const job = S.jobs.find((j) => j.name === S.chat.job); if (!job) { el.hidden = true; return; }
  el.hidden = false;
  const t = S.tasks?.[job.name];
  const done = t?.rows?.length ? t.done : (job.approved || 0), total = t?.rows?.length ? t.total : job.count;
  $('#tb-progress-txt').textContent = `${done}/${total}`;
  el.querySelector('.progress-ring').style.setProperty('--p', `${total ? Math.round((done / total) * 100) : 0}%`);
  el.title = t?.rows?.length ? `${done} of ${total} tasks done` : `${done} of ${total} files approved`;
  if (!t || Date.now() - t.at > 15000) loadTasks(job.name).then((x) => { if (x && S.chat?.job === job.name) updateProgress(); });
}
// STATUS.md is the pipeline's own task table: | Item | State | Version | Rerolls | Note |
function parseStatus(md) {
  const rows = [];
  for (const line of String(md || '').split('\n')) {
    const m = line.match(/^\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|?\s*$/);
    if (!m) continue;
    const [, item, state, version, rerolls, note] = m;
    if (!item || /^item$/i.test(item) || /^:?-+:?$/.test(item)) continue;
    rows.push({ item, state: state.trim(), version: version.trim(), rerolls: rerolls.trim(), note: note.trim(), kind: taskKind(state) });
  }
  return rows;
}
function taskKind(state) {
  const st = String(state || '').trim().toUpperCase();
  // the pipeline's own words (MAIN.md): OKAY / APPROVED / GATE / GENERATING / RUNNING / PLANNED or a dash / ON HOLD / BLOCKED / SKIPPED / OFF
  if (!st || /^[\u2014\u2013-]+$/.test(st) || /PLANNED|TODO|PENDING|WAITING|QUEUED|NEXT/.test(st)) return 'todo';
  if (/^OFF$|SKIP|N\/A|DISABLED/.test(st)) return 'off';
  if (/FAIL|REJECT|STOPPED|ERROR/.test(st)) return 'failed';
  if (/HOLD|BLOCKED|PAUSED/.test(st)) return 'hold';
  if (/GATE|REVIEW|AWAITING|CHECK/.test(st)) return 'review';
  if (/RUNNING|GENERATING|RENDERING|PROGRESS|DRAFT|SCOUT/.test(st)) return 'running';
  if (/APPROVED|OKAY|^OK$|DONE|LOCKED|COMPLETE|PASS/.test(st)) return 'done';
  return 'running';
}
async function loadTasks(job) {
  const j = await api('/api/jobs/' + encodeURIComponent(job)).catch(() => null); if (!j) return null;
  let rows = parseStatus(j.status).filter((r) => r.kind !== 'off');
  const media = j.media || [];
  if (!rows.length) { // no STATUS.md yet: one task per item folder, done when it has an approved file
    const groups = [...new Set(media.map((m) => m.item || 'other'))];
    rows = groups.map((g) => { const done = media.some((m) => (m.item || 'other') === g && m.approved); return { item: g, state: done ? 'APPROVED' : 'RUNNING', kind: done ? 'done' : 'running', version: '', rerolls: '', note: '' }; });
  }
  const t = { at: Date.now(), rows, media, done: rows.filter((r) => r.kind === 'done').length, running: rows.filter((r) => r.kind === 'running').length, review: rows.filter((r) => r.kind === 'review').length, total: rows.length };
  S.tasks = S.tasks || {}; S.tasks[job] = t; return t;
}
const TASK_LABEL = { done: 'Done', review: 'Review', running: 'Working', todo: 'Planned', hold: 'On hold', failed: 'Failed', off: 'Off' };
// The progress pill's popover: every item of the job with its state, click a row to see its files.
async function openTaskList(anchor) {
  const job = S.chat?.job; if (!job) return toast('No job folder on this chat yet.');
  const el = openMenu(anchor, 'tasks', `<div class="tl-head"><div class="tl-title">${esc(job.replace(/^\d{4}-\d{2}-\d{2}-/, ''))}</div><div class="tl-sub">Loading</div></div>`, { above: false, align: 'right' });
  const t = await loadTasks(job); if (!S.menu || S.menu.el !== el) return;
  const rows = t?.rows || []; const media = t?.media || [];
  const filesFor = (item) => { const key = item.replace(/\s+(still|storyboard|sheet|clip|video)$/i, '').trim().toLowerCase(); return media.filter((m) => (m.item || '').toLowerCase() === key || (m.rel || '').toLowerCase().includes('/' + key + '/')); };
  const list = rows.map((r, i) => { const files = filesFor(r.item); return `<button class="tl-row ${r.kind}" data-i="${i}" title="${esc(r.note || r.state)}"><span class="tl-ic">${r.kind === 'done' ? icon('check') : r.kind === 'running' ? '<span class="spin"></span>' : r.kind === 'failed' ? icon('warning') : ''}</span><span class="tl-col"><span class="tl-nm"><span>${esc(r.item)}</span>${r.version ? `<span class="tl-v">${esc(r.version)}</span>` : ''}${files.length ? `<span class="tl-n">${files.length} file${files.length === 1 ? '' : 's'}</span>` : ''}</span>${r.note ? `<span class="tl-note">${esc(r.note)}</span>` : ''}</span><span class="tl-state">${esc(TASK_LABEL[r.kind] || r.state)}</span></button>`; }).join('');
  const done = rows.filter((r) => r.kind === 'done').length, running = rows.filter((r) => r.kind === 'running').length, review = rows.filter((r) => r.kind === 'review').length, total = rows.length;
  el.innerHTML = `<div class="tl-head"><div class="tl-title">${esc(job.replace(/^\d{4}-\d{2}-\d{2}-/, ''))}</div><div class="tl-sub">${total ? `${done} of ${total} done${review ? ` · ${review} to review` : ''}${running ? ` · ${running} working` : ''}` : 'Nothing planned yet'}</div><div class="tl-bar"><i style="width:${total ? Math.round((done / total) * 100) : 0}%"></i></div></div><div class="tl-list">${list || `<div class="tl-empty">The agent has not written a task list for this job yet.</div>`}</div><div class="tl-foot"><button class="tl-open" id="tl-open">${icon('project_folder')}<span>Open files</span></button></div>`;
  mountIcons(el); positionMenu();
  $('#tl-open', el).onclick = () => { closeMenu(); S.cvJob = job; S.cvMode = 'history'; S.cvTab = ''; toggleCV(true); };
  for (const b of $$('.tl-row', el)) b.onclick = () => {
    const r = rows[Number(b.dataset.i)]; const files = filesFor(r.item);
    closeMenu();
    if (files.length) { const pick = files.find((m) => m.approved) || files[0]; lightbox(fileUrl(pick.path), pick.path); return; }
    S.cvJob = job; S.cvMode = 'history'; S.cvTab = media.some((m) => (m.item || '') === r.item) ? r.item : ''; toggleCV(true);
  };
}

// ---------------------------------------------------------------- request surfaces (question / approval) inside the composer shell
function panelHost() { return $('#chat-composer'); }
// Inspect: the approval panel's look, with the prompt itself editable. From a ```prompt block in chat, or from a
// prompt-file link. Save writes the file and tells the agent to read it again; with no file, Send hands the text over.
function showInspect(o) {
  if (S.approve || S.ask) return toast('Answer the open request first.');
  S.inspect = o;
  const html = `<div class="sur-grip" title="Resize">${icon('swap_vertical')}</div><div class="sur-head">${icon('content_viewer')}<h3>Inspect prompt${o.label ? ` · ${esc(o.label)}` : ''}</h3></div><div class="sur-body"><div class="apr-one"><div class="pr edit open" id="ins-pr" contenteditable="true" spellcheck="false">${esc(o.text || '')}</div></div><div class="chipbar"><span class="mchip">${icon('generation')}<span>${modelName(curProvider())}</span></span>${o.path ? `<a class="path text" href="#" data-path="${esc(o.path)}" title="${esc(o.path)}">${esc(o.path.split(/[\\/]/).pop())}</a>` : ''}<span class="apr-hint">${icon('edit')}${o.path ? 'Edit the text, then Save' : 'Edit the text, then Send it to the agent'}</span></div></div><div class="sur-foot"><div class="editor" id="ins-note" contenteditable="true" data-placeholder="Type something else..."></div><div class="btns"><button class="btn ghost" id="ins-copy">${icon('copy')}Copy</button><button class="btn ghost" id="ins-cancel">Cancel <kbd>Esc</kbd></button><button class="btn lime" id="ins-save">${o.path ? 'Save' : 'Send'} <span class="star">${icon('check')}</span><kbd>↵</kbd></button></div></div>`;
  const sur = showSurface(html); sur.classList.add('lime');
  const pr = $('#ins-pr', sur); pr.focus();
  const a = sur.querySelector('a.path'); if (a) a.onclick = (e) => { e.preventDefault(); api('/api/open-folder', { method: 'POST', body: { path: o.path } }).catch(() => {}); };
  $('#ins-copy', sur).onclick = () => { navigator.clipboard.writeText(pr.innerText); toast('Copied'); };
  $('#ins-cancel', sur).onclick = hideInspect;
  $('#ins-save', sur).onclick = () => saveInspect();
  $('#chat-foot').textContent = o.path ? 'Save writes the prompt file; the agent reads it again before it renders' : 'Send hands the prompt to the agent as your next message';
}
function hideInspect() { S.inspect = null; hidePanel(); }
async function saveInspect() {
  const o = S.inspect; if (!o) return;
  const text = $('#ins-pr').innerText.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const note = $('#ins-note').innerText.trim();
  if (!text) return toast('The prompt is empty.', true);
  const changed = text !== (o.text || '').trim();
  let msg = '';
  if (o.path) {
    if (changed) { try { await api('/api/prompt', { method: 'POST', body: { path: o.path, text } }); toast('Saved'); } catch { return toast('Could not save that file.', true); } msg = `I edited ${o.label || 'the prompt'} in the app (${o.path}). Read the file again before you use it.`; }
  } else msg = `Use this prompt for ${o.label || 'the prompt'} instead:\n\n\`\`\`\n${text}\n\`\`\``;
  if (note) msg = msg ? `${msg}\n\n${note}` : note;
  hideInspect();
  if (msg) sendOrQueue(msg);
}
function sendOrQueue(text, display) {
  if (!S.chat) return;
  if (!S.chat.working) { wsSend({ t: 'send', chatId: S.chat.id, text, files: [], display: display || '' }); S.chat.working = true; updateSend('chat'); }
  else { $('#chat-editor').textContent = text; toast('Put in the composer; send it when the agent is done.'); }
}

// The grip above a panel drags it taller (or shorter): pull up to read a long prompt in full. Double-click snaps
// between the compact three-line view and the full one.
function wireGrip(sur) {
  const grip = sur.querySelector('.sur-grip'), body = sur.querySelector('.sur-body'); if (!grip || !body) return;
  const minH = 120, maxH = () => Math.round(window.innerHeight * 0.82);
  const setH = (px) => { const h = Math.max(minH, Math.min(maxH(), px)); body.style.maxHeight = `${h}px`; sur.classList.toggle('tall', h > body.scrollHeight - 4 || h >= 300); };
  grip.onpointerdown = (e) => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = body.getBoundingClientRect().height; sur.classList.add('dragging'); let moved = false;
    grip.onpointermove = (ev) => { const dy = y0 - ev.clientY; if (Math.abs(dy) > 2) moved = true; if (moved) setH(h0 + dy); };
    grip.onpointerup = grip.onpointercancel = () => { grip.onpointermove = null; grip.onpointerup = grip.onpointercancel = null; sur.classList.remove('dragging'); };
  };
  grip.ondblclick = () => { if (sur.classList.contains('tall')) { body.style.maxHeight = ''; sur.classList.remove('tall'); } else { sur.classList.add('tall'); body.style.maxHeight = `${Math.min(maxH(), body.scrollHeight + 8)}px`; } };
}

function hidePanel() {
  const host = panelHost(); const sur = host.querySelector('.surface');
  if (sur) { sur.classList.remove('in'); setTimeout(() => sur.remove(), 240); }
  host.classList.remove('request'); $('#v-chat').classList.remove('dim');
  for (const el of ['#chat-attach', '#chat-editor']) $(el).hidden = false; $('#chat-composer .composer-row').hidden = false; if (!S.attachments.chat.length) $('#chat-attach').hidden = true;
  $('#chat-foot').textContent = 'LLMs can make mistakes and calls cost credits';
  renderChats();
}
function showSurface(html) {
  const host = panelHost(); host.querySelector('.surface')?.remove();
  $('#chat-editor').hidden = true; $('#chat-attach').hidden = true; host.querySelector('.composer-row').hidden = true;
  host.classList.add('request'); $('#v-chat').classList.add('dim');
  const sur = h(`<div class="surface">${html}</div>`); host.appendChild(sur); mountIcons(sur);
  wireGrip(sur);
  requestAnimationFrame(() => sur.classList.add('in'));
  const t = S.chat?.messages.find((m) => m.role === 'assistant' && m.status === 'working'); if (t) renderTurnHeader(t);
  return sur;
}
function showAsk(m) {
  S.approve = null;
  S.ask = { requestId: m.requestId, questions: m.questions, index: 0, sel: m.questions.map((q) => (q.multiSelect ? [] : 0)), other: m.questions.map(() => ''), note: '' };
  renderAsk();
}
function renderAsk() {
  const a = S.ask; if (!a) return; const q = a.questions[a.index]; const n = a.questions.length;
  const opts = q.options.map((o, i) => { const sel = q.multiSelect ? a.sel[a.index].includes(i) : a.sel[a.index] === i; return `<button class="opt${sel ? ' sel' : ''}" data-i="${i}"><span class="num">${sel && q.multiSelect ? icon('check') : i + 1}</span><span><div class="ot">${esc(o.label)}</div>${o.description ? `<div class="od">${esc(o.description)}</div>` : ''}</span></button>`; }).join('');
  const html = `<div class="sur-head ask"><div class="q-col">${q.header ? `<span class="q-idx">${esc(q.header)}</span>` : ''}<h3>${esc(q.question)}</h3></div>${n > 1 ? `<span class="pager"><button data-pg="-1" ${a.index === 0 ? 'disabled' : ''}>${icon('chevron_row').replace('<svg', '<svg style="transform:rotate(180deg)"')}</button><span>${a.index + 1}/${n}</span><button data-pg="1" ${a.index === n - 1 ? 'disabled' : ''}>${icon('chevron_row')}</button></span>` : ''}</div><div class="sur-body"><div class="opts">${opts}</div><div class="opt-else"><span class="num dash">${icon('edit')}</span><textarea rows="1" placeholder="Something else" id="ask-other">${esc(a.other[a.index])}</textarea></div></div><div class="sur-foot"><div class="editor" id="ask-note" contenteditable="true" data-placeholder="No, and tell us what to do differently">${esc(a.note)}</div><div class="btns"><button class="btn skip" id="ask-skip">Skip <kbd>Esc</kbd></button><button class="btn lime" id="ask-submit">Submit <kbd>↵</kbd></button></div></div>`;
  const sur = showSurface(html);
  for (const b of $$('.opt', sur)) b.onclick = () => toggleOption(Number(b.dataset.i));
  for (const b of $$('[data-pg]', sur)) b.onclick = () => { a.index = Math.max(0, Math.min(n - 1, a.index + Number(b.dataset.pg))); renderAsk(); };
  const other = $('#ask-other', sur); other.oninput = () => { a.other[a.index] = other.value; if (other.value.trim()) { a.sel[a.index] = q.multiSelect ? [] : -1; for (const o of $$('.opt', sur)) o.classList.remove('sel'); } }; other.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); answerSubmit(); } };
  const note = $('#ask-note', sur); note.oninput = () => { a.note = note.textContent; };
  $('#ask-skip', sur).onclick = answerSkip; $('#ask-submit', sur).onclick = answerSubmit;
  $('#chat-foot').textContent = 'LLMs can make mistakes and calls cost credits';
  setTimeout(() => { if (!q.multiSelect && a.sel[a.index] === -1) other.focus(); }, 60);
}
function toggleOption(i) {
  const a = S.ask; const q = a.questions[a.index]; const n = a.questions.length;
  a.other[a.index] = ''; const other = $('#ask-other'); if (other) other.value = '';
  if (q.multiSelect) {
    const s = a.sel[a.index]; const k = s.indexOf(i); if (k >= 0) s.splice(k, 1); else s.push(i);
    for (const o of $$('.surface .opt')) { const on = s.includes(Number(o.dataset.i)); o.classList.toggle('sel', on); o.querySelector('.num').innerHTML = on ? icon('check') : String(Number(o.dataset.i) + 1); }
    return;
  }
  // one choice = the answer: mark it in place and send (several questions: move on, submit after the last)
  a.sel[a.index] = i;
  for (const o of $$('.surface .opt')) o.classList.toggle('sel', Number(o.dataset.i) === i);
  if (n > 1 && a.index < n - 1) { setTimeout(() => { if (S.ask === a) { a.index += 1; renderAsk(); } }, 160); return; }
  answerSubmit();
}
function answerSkip() { if (!S.ask) return; wsSend({ t: 'answer', chatId: S.chat.id, requestId: S.ask.requestId, skip: true, answers: {} }); S.ask = null; hidePanel(); showNextRequest(); }
function answerSubmit() {
  const a = S.ask; if (!a) return;
  const answers = {};
  a.questions.forEach((q, qi) => { const other = a.other[qi].trim(); if (other) { answers[q.question] = other; return; } if (q.multiSelect) { const labels = a.sel[qi].map((i) => q.options[i].label); if (labels.length) answers[q.question] = labels.join(', '); } else if (a.sel[qi] >= 0) answers[q.question] = q.options[a.sel[qi]].label; });
  if (a.note.trim()) answers['Additional note from the user'] = a.note.trim();
  const unanswered = a.questions.filter((q) => !answers[q.question]);
  if (unanswered.length && a.questions.length > 1 && a.index < a.questions.length - 1) { a.index = a.questions.indexOf(unanswered[0]); renderAsk(); return; }
  if (!Object.keys(answers).length) { toast('Pick an option or type something.'); return; }
  const btn = $('#ask-submit'); if (btn) { btn.disabled = true; btn.textContent = 'Submitting'; }
  wsSend({ t: 'answer', chatId: S.chat.id, requestId: a.requestId, answers });
  S.ask = null; setTimeout(hidePanel, 120); showNextRequest();
}
// What an approval item is, in words, when its prompt text cannot be read yet (the command writes the file first).
function genSummary(it) {
  const what = it.video ? 'video' : 'image';
  const name = it.item ? `${it.item}${it.version ? ' v' + it.version : ''}` : `one ${what}`;
  const pf = (String(it.command || '').match(/--prompt-file\s+("[^"]+"|'[^']+'|\S+)/) || [])[1];
  return `Render ${name}${pf ? ` from ${pathLabel(pf.replace(/^["']|["']$/g, ''))}` : ''}. The prompt file is read when it runs.`;
}
// One request on screen at a time. Sheet agents fire their approvals seconds apart; the second used to replace the
// first, which then hung on the server as "Awaiting approval" with no way to click it. Now they wait in line.
function enqueueRequest(kind, m) {
  S.queue = S.queue || [];
  if (S.ask || S.approve) {
    if (S.queue.some((q) => q.m.requestId === m.requestId)) return;
    S.queue.push({ kind, m }); queueBadge();
    toast(kind === 'approve' ? `Another approval is waiting (${S.queue.length} in line)` : `Another question is waiting (${S.queue.length} in line)`);
    return;
  }
  if (kind === 'approve') showApprove(m); else showAsk(m);
}
function showNextRequest() {
  const q = S.queue || []; if (!q.length) return;
  setTimeout(() => { if (S.ask || S.approve) return; const next = q.shift(); if (!next) return; if (next.kind === 'approve') showApprove(next.m); else showAsk(next.m); }, 280);
}
function queueBadge() {
  const head = $('.surface .sur-head'); if (!head) return;
  let b = $('.q-wait', head); const n = (S.queue || []).length;
  if (!n) { if (b) b.remove(); return; }
  if (!b) { b = h('<span class="q-wait"></span>'); head.appendChild(b); }
  b.textContent = `${n} more waiting`;
}
function showApprove(m) {
  S.ask = null; S.approve = { requestId: m.requestId, items: m.items };
  const n = m.items.length;
  const video = m.items.some((i) => i.video);
  const one = m.items[0];
  // Single request: the prompt itself, three lines, then the model chip (as captured live). Several: a numbered list.
  const items = n === 1
    ? `<div class="apr-one"><div class="pr${one.prompt ? ' edit' : ''}" data-n="${one.n}"${one.prompt ? ' contenteditable="true" spellcheck="false" title="Click to change the prompt before it runs"' : ''}>${esc(one.prompt || genSummary(one))}</div>${(one.prompt || '').length > 220 ? '<button class="more">Show full prompt</button>' : ''}</div>`
    : `<div class="apr-list">${m.items.map((it) => `<div class="apr-item"><span class="n">${it.n}</span><div class="th">${icon('generation')}</div><div class="body"><div class="cap">${esc(it.item || 'image')}${it.version ? ` · v${it.version}` : ''}${it.video ? ' · video' : ''}</div><div class="pr${it.prompt ? ' edit' : ''}" data-n="${it.n}"${it.prompt ? ' contenteditable="true" spellcheck="false" title="Click to change the prompt before it runs"' : ''}>${esc(it.prompt || genSummary(it))}</div>${it.prompt && it.prompt.length > 220 ? '<button class="more">Show full prompt</button>' : ''}</div></div>`).join('')}</div>`;
  const vids = m.items.filter((i) => i.video);
  const previz = vids.length > 0 && vids.every((i) => i.previz || i.params?.provider === 'blender');
  const settings = vids.map((it) => (it.previz || it.params?.provider === 'blender') ? previzSettingsHtml(it, n > 1) : videoSettingsHtml(it, n > 1)).join('');
  const html = `<div class="sur-grip" title="Resize">${icon('swap_vertical')}</div><div class="sur-head">${icon('content_viewer')}<h3>${previz ? `Approve Blender clip${n === 1 ? '' : ' × ' + n}` : `Approve ${n === 1 ? '' : n + ' '}${video ? 'video' : 'image'} generation${n === 1 ? '' : 's'}`}</h3></div><div class="sur-body">${items}${settings}<div class="chipbar"><span class="mchip" id="apr-model">${icon('generation')}<span>${video ? videoLabel(vids[0]?.params) : modelName(m.items[0]?.provider)}</span>${video ? `<b class="cost" id="apr-cost">${videoCost(vids[0]?.params)}</b>` : icon('chevron_down')}</span>${m.items.some((i) => i.prompt) ? `<span class="apr-hint">${icon('edit')}Click the prompt to change it before it runs</span>` : ''}</div></div><div class="sur-foot"><div class="editor" id="apr-note" contenteditable="true" data-placeholder="Type something else..."></div><div class="btns"><button class="btn ghost" id="apr-always"><span class="dash-circle">${icon('check')}</span>Always allow</button><button class="btn ghost" id="apr-stop">Stop <kbd>Esc</kbd></button><button class="btn lime" id="apr-ok">Approve <span class="star">${icon('generation')}</span>${(() => { const t = m.items.reduce((a, i) => a + (i.credits || 0), 0); const p = m.items[0]?.provider; const u = m.items.reduce((a, i) => a + (i.usd || 0), 0); return previz ? 'free' : t ? t.toLocaleString() : u ? `$${u.toFixed(2)}` : (p && p !== 'elevenlabs' ? PROV_NAME[p] : n); })()} <kbd>↵</kbd></button></div></div>`;
  const sur = showSurface(html); sur.classList.add('lime');
  for (const b of $$('.more', sur)) b.onclick = () => { const pr = b.previousElementSibling; pr.classList.toggle('open'); b.textContent = pr.classList.contains('open') ? 'Show less' : 'Show full prompt'; };
  wireVideoSettings(sur);
  $('#apr-always', sur).onclick = () => decide('always'); $('#apr-stop', sur).onclick = () => decide('stop'); $('#apr-ok', sur).onclick = () => decide('allow');
  $('#chat-foot').textContent = 'LLMs can make mistakes and calls cost credits';
  queueBadge();
}
// The video settings row under a clip's prompt: every value PiAPI's Seedance offers, priced live. 2K and 4K are listed so
// nobody hunts for them, but disabled: PiAPI does not offer them for Seedance (the tool renders such a setting at 1080p).
// One resolution option's label: the per-second price on PiAPI, the learned credit rate on ElevenLabs.
function resOptionText(provider, model, r, table) {
  const cat = videoCatalog(provider); if (!cat[model].res.includes(r)) return `${r} · not on this model`;
  if (provider === 'piapi') return `${r} · $${cat[model].usd[r]}/s`;
  const per = (table || {})[`${model} ${r}`]; return per ? `${r} · ${per} credits/s` : r;
}
function videoSettingsHtml(it, numbered) {
  const pr = it.params || { provider: 'piapi', model: 'seedance-2.5', resolution: '1080p', duration: 6, aspect: '16:9', audio: true };
  const provider = VIDEO_PROV_NAME[pr.provider] ? pr.provider : 'piapi'; const cat = videoCatalog(provider);
  const model = cat[pr.model] ? pr.model : 'seedance-2.5';
  const opt = (v, t, sel, dis) => `<option value="${esc(v)}" ${sel ? 'selected' : ''} ${dis ? 'disabled' : ''}>${esc(t)}</option>`;
  const resOpts = ['480p', '720p', '1080p'].map((r) => opt(r, resOptionText(provider, model, r, pr.creditTable), r === pr.resolution, !cat[model].res.includes(r))).join('') + opt('2k', `2K · not offered by ${VIDEO_PROV_NAME[provider]}`, false, true) + opt('4k', `4K · not offered by ${VIDEO_PROV_NAME[provider]}`, false, true);
  const billing = provider === 'piapi' ? 'Billed per second of output; a failed clip is refunded.' : 'Billed in ElevenLabs credits per second of output; the exact figure is read from the account after the clip. A failed clip is not charged.';
  return `<div class="vid-set" data-n="${it.n}" data-provider="${provider}">${numbered ? `<div class="vs-cap">${esc(it.item || 'video')}${it.version ? ` · v${it.version}` : ''}</div>` : ''}<div class="vs-grid">
    <label><span>Model · ${VIDEO_PROV_NAME[provider]}</span><select data-k="model">${Object.entries(cat).map(([v, mm]) => opt(v, mm.name, v === model)).join('')}</select></label>
    <label><span>Resolution</span><select data-k="resolution">${resOpts}</select></label>
    <label><span>Seconds</span><input type="number" data-k="duration" min="4" max="${cat[model].max}" step="1" value="${Number(pr.duration) || 6}"></label>
    <label><span>Aspect</span><select data-k="aspect">${VIDEO_ASPECTS.map((a) => opt(a, a, a === pr.aspect)).join('')}${pr.frames ? opt('adaptive', 'Match the frame', pr.aspect === 'adaptive') : ''}</select></label>
    <label><span>Sound</span><select data-k="audio">${opt('on', 'Generated audio', pr.audio !== false)}${opt('off', 'Silent', pr.audio === false)}</select></label>
  </div><div class="vs-note">${pr.capped ? `The job asked for ${esc(String(pr.asked).toUpperCase())}; ${VIDEO_PROV_NAME[provider]} tops out at 1080p for Seedance, so 1080p is selected. ` : ''}${pr.refs ? `${pr.refs} reference sheet${pr.refs === 1 ? '' : 's'} attached. ` : ''}${billing}</div></div>`;
}
// The Blender clip settings row: what Blender renders on this machine. No price, so the note says so.
function previzSettingsHtml(it, numbered) {
  const pr = it.params || { resolution: '1080p', fps: 24, seconds: null, engine: 'eevee', aspect: '16:9' };
  const opt = (v, t, sel) => `<option value="${esc(String(v))}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  return `<div class="vid-set previz" data-n="${it.n}" data-provider="blender">${numbered ? `<div class="vs-cap">${esc(it.item || 'blender')}${it.version ? ` · v${it.version}` : ''}</div>` : ''}<div class="vs-grid">
    <label><span>Resolution</span><select data-k="resolution">${['720p', '1080p', '1440p', '4k'].map((r) => opt(r, r === '4k' ? '4K · 3840×2160' : r === '1440p' ? '1440p · 2560×1440' : r === '1080p' ? '1080p · 1920×1080' : '720p · 1280×720', r === pr.resolution)).join('')}</select></label>
    <label><span>Frames per second</span><select data-k="fps">${[24, 25, 30, 60].map((f) => opt(f, `${f} fps`, f === Number(pr.fps))).join('')}</select></label>
    <label><span>Seconds</span><input type="number" data-k="seconds" min="1" max="120" step="1" placeholder="script's range" value="${pr.seconds ? Number(pr.seconds) : ''}"></label>
    <label><span>Engine</span><select data-k="engine">${opt('eevee', 'Eevee · lit, with depth of field', pr.engine !== 'workbench')}${opt('workbench', 'Workbench · flat, fastest', pr.engine === 'workbench')}</select></label>
    <label><span>Aspect</span><select data-k="aspect">${['16:9', '9:16', '1:1', '4:3', '21:9'].map((a) => opt(a, a, a === pr.aspect)).join('')}</select></label>
  </div><div class="vs-note">Renders on this machine with Blender${pr.version ? ' ' + pr.version : ''}. No credits. About 1.5 s per 1080p frame; leave Seconds empty to keep the script's own frame range.${pr.script ? ` Script: ${esc(pr.script)}.` : ''}</div></div>`;
}
function readPrevizSettings(box) {
  const g = (k) => box.querySelector(`[data-k="${k}"]`)?.value;
  const sec = String(g('seconds') ?? '').trim();
  return { provider: 'blender', resolution: ['720p', '1080p', '1440p', '4k'].includes(g('resolution')) ? g('resolution') : '1080p', fps: [24, 25, 30, 60].includes(Number(g('fps'))) ? Number(g('fps')) : 24, seconds: sec ? Math.max(1, Math.min(120, Math.round(Number(sec)))) : null, engine: g('engine') === 'workbench' ? 'workbench' : 'eevee', aspect: ['16:9', '9:16', '1:1', '4:3', '21:9'].includes(g('aspect')) ? g('aspect') : '16:9' };
}
function readVideoSettings(box) {
  if (box.dataset.provider === 'blender') return readPrevizSettings(box);
  const g = (k) => box.querySelector(`[data-k="${k}"]`)?.value;
  const provider = VIDEO_PROV_NAME[box.dataset.provider] ? box.dataset.provider : 'piapi'; const cat = videoCatalog(provider);
  const model = cat[g('model')] ? g('model') : 'seedance-2.5';
  let dur = Math.max(4, Math.min(cat[model].max, Math.round(Number(g('duration')) || 6)));
  if (cat[model].fixed && !cat[model].fixed.includes(dur)) dur = cat[model].fixed.reduce((a, b) => Math.abs(b - dur) < Math.abs(a - dur) ? b : a);
  let res = g('resolution'); if (!cat[model].res.includes(res)) res = cat[model].res.includes('1080p') ? '1080p' : cat[model].res[cat[model].res.length - 1];
  return { provider, model, resolution: res, duration: dur, aspect: g('aspect') || '16:9', audio: g('audio') !== 'off' };
}
function wireVideoSettings(sur) {
  const boxes = $$('.vid-set', sur); if (!boxes.length) return;
  upgradeSelects(sur);
  const tableOf = (box) => (S.approve?.items || []).find((i) => String(i.n) === box.dataset.n)?.params?.creditTable || {};
  const refresh = () => {
    let usdTotal = 0, creditTotal = 0, unknown = false, provider = 'piapi';
    for (const box of boxes) {
      const w = readVideoSettings(box);
      if (w.provider === 'blender') { provider = 'blender'; const chip0 = $('#apr-model span', sur); if (chip0 && boxes.length === 1) chip0.textContent = videoLabel({ ...w, version: (S.approve?.items || []).find((i) => String(i.n) === box.dataset.n)?.params?.version }); continue; }
      const cat = videoCatalog(w.provider); provider = w.provider;
      if (w.provider === 'piapi') usdTotal += videoUsd(w); else { const per = tableOf(box)[`${w.model} ${w.resolution}`]; if (per) creditTotal += per * w.duration; else unknown = true; }
      const model = box.querySelector('[data-k="model"]'); const res = box.querySelector('[data-k="resolution"]'); const dur = box.querySelector('[data-k="duration"]');
      for (const o of res.options) { if (/^\d+p$/.test(o.value)) { o.disabled = !cat[w.model].res.includes(o.value); o.textContent = resOptionText(w.provider, w.model, o.value, tableOf(box)); } }
      if (res.value !== w.resolution) { res.value = w.resolution; res.dispatchEvent(new Event('change', { bubbles: true })); }
      dur.max = cat[w.model].max; if (Number(dur.value) !== w.duration) dur.value = w.duration;
      model.closest('.vid-set').dataset.usd = w.provider === 'piapi' ? videoUsd(w) : '';
    }
    if (provider === 'blender') { const cost0 = $('#apr-cost', sur); if (cost0) cost0.textContent = 'no credits'; return; }
    const chip = $('#apr-model span', sur); if (chip && boxes.length === 1) chip.textContent = videoLabel(readVideoSettings(boxes[0]));
    const cost = $('#apr-cost', sur); if (cost) cost.textContent = provider === 'piapi' ? `~$${usdTotal.toFixed(2)}` : (creditTotal && !unknown ? `~${creditTotal.toLocaleString()} credits` : creditTotal ? `~${creditTotal.toLocaleString()} credits + more after the clip` : 'credits after the clip');
  };
  for (const box of boxes) { box.addEventListener('change', refresh); box.addEventListener('input', refresh); }
  refresh();
}
function decide(decision, note) {
  const a = S.approve; if (!a) return;
  // Prompts changed in the panel travel with the decision; the server writes them to the prompt files before the run.
  const prompts = {};
  for (const el of $$('.surface .pr.edit[data-n]')) { const orig = ((a.items.find((i) => String(i.n) === el.dataset.n) || {}).prompt || '').trim(); const now = el.innerText.replace(/\u00a0/g, ' ').trim(); if (now && now !== orig) prompts[el.dataset.n] = now; }
  // Video settings changed in the panel travel the same way; the server rewrites the command before the tool runs.
  const params = {};
  for (const box of $$('.surface .vid-set[data-n]')) { const it = a.items.find((i) => String(i.n) === box.dataset.n); const w = readVideoSettings(box); const o = it?.params || {}; if (w.provider === 'blender') { if (w.resolution !== o.resolution || w.fps !== Number(o.fps) || (w.seconds || null) !== (o.seconds || null) || w.engine !== (o.engine || 'eevee') || w.aspect !== (o.aspect || '16:9')) params[box.dataset.n] = w; continue; } if (w.model !== (o.model || 'seedance-2.5') || w.resolution !== o.resolution || w.duration !== Number(o.duration) || w.aspect !== o.aspect || w.audio !== (o.audio !== false)) params[box.dataset.n] = { ...w, audio: w.audio ? 'on' : 'off' }; }
  wsSend({ t: 'approve', chatId: S.chat.id, requestId: a.requestId, decision, prompts: Object.keys(prompts).length ? prompts : undefined, params: Object.keys(params).length ? params : undefined });
  if (decision !== 'stop' && Object.keys(prompts).length) toast(`Prompt ${Object.keys(prompts).length === 1 ? 'change' : 'changes'} saved to the job`);
  if (decision !== 'stop' && Object.keys(params).length) toast(`Video settings changed: ${Object.values(params).map((w) => videoLabel(w)).join('; ')}`);
  S.approve = null; hidePanel(); showNextRequest();
  if (note) { S.pendingNote = note; setTimeout(() => { if (!S.chat?.working) { wsSend({ t: 'send', chatId: S.chat.id, text: note, files: [] }); S.chat.working = true; updateSend('chat'); } else $('#chat-editor').textContent = note; }, 1500); }
  if (decision === 'always') toast('Generations in this chat will run without asking. Switch the mode back to Ask to reset.');
}

// ---------------------------------------------------------------- content viewer + lightbox
// Ctrl+W / Alt+W: close the browser tab and the side panel with it.
function closeBrowserTab() {
  if (S.bro.open && S.chat) wsSend({ t: 'bro_close', chatId: S.chat.id });
  S.bro = { ...S.bro, open: false, frame: null, url: '', title: '', pick: false, box: null };
  if (S.cvOpen) toggleCV(false);
  $('#chat-editor')?.focus();
}
function isCloseKey(e) { return (e.ctrlKey || e.altKey) && !e.shiftKey && e.key.toLowerCase() === 'w'; }
// The panel splits the screen (Sir Marco: no overlap): the chat column gives up the panel's width, like a VS Code split.
function cvWidth() { return parseInt($('#cv').style.width) || 420; }
function setCVWidth(w) {
  const sidebar = $('#app').classList.contains('collapsed') ? 0 : 232;
  const narrow = innerWidth < 1100, minW = narrow ? 300 : 360, minChat = narrow ? 360 : 420; // both halves stay usable
  const maxW = Math.max(minW, innerWidth - sidebar - minChat);
  w = Math.max(minW, Math.min(maxW, Math.round(w)));
  $('#cv').style.width = w + 'px'; $('.main').style.setProperty('--cvw', w + 'px');
}
function toggleCV(open) { S.cvOpen = open == null ? !S.cvOpen : open; $('#cv').classList.toggle('open', S.cvOpen); $('.main').classList.toggle('split', S.cvOpen); if (S.cvOpen) renderCV(); }
function allRefs() { if (!S.chat) return []; return S.chat.messages.flatMap((m) => m.role === 'assistant' ? (m.blocks || []).filter((b) => b.kind === 'refs') : []); }
// The sets under review: every open one; when none is open, the latest one (so the panel still shows what was decided).
function reviewRefs() { const all = allRefs().filter((b) => !(b.picked && (b.status !== 'open' || !(b.items || []).length))); const open = all.filter((b) => b.status === 'open' || b.status === 'searching'); return open.length ? open : all.slice(-1); }
function latestRefs() { const all = allRefs(); return all[all.length - 1] || null; }
function refsSelFor(b) { S.refsSel ||= {}; if (!S.refsSel[b.id]) S.refsSel[b.id] = new Set(b.items.filter((i) => i.keep !== false).map((i) => i.n)); return S.refsSel[b.id]; }
function renderCVModes() {
  const el = $('#cv-modes'); if (!el) return;
  const open = allRefs().filter((b) => b.status === 'open'); const openN = open.reduce((n, b) => n + b.items.length, 0);
  const modes = [['history', 'History', 'h_chats_chevron'], ['browser', 'Browser', 'explored'], ['refs', 'References', 'view_grid']];
  if (S.connections?.blender?.connected) modes.push(['blender', 'Blender', null]);
  else if (S.cvMode === 'blender') S.cvMode = 'history';
  el.innerHTML = modes.map(([k, n, ic]) => `<button class="cv-mode${S.cvMode === k ? ' on' : ''}" data-m="${k}">${ic ? icon(ic) : '<img class="mode-logo" src="logos/blender.svg" alt="">'}<span>${n}</span>${k === 'refs' && openN ? `<b class="badge">${openN}</b>` : ''}</button>`).join('');
  for (const b of $$('.cv-mode', el)) b.onclick = () => { S.cvMode = b.dataset.m; S.cvJob = null; S.cvPick = S.scout?.phase === 'searching'; renderCV(); };
  for (const id of ['cv-filter', 'cv-view']) $('#' + id).hidden = S.cvMode !== 'history';
}
// The browser in the panel: a real tab the user drives (click, scroll, type, navigate) and the agent shares.
const BRO_SVG = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  reload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>',
  pick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5-8 8"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
};
const BRO_LINKS = [['Pinterest', 'https://www.pinterest.com/'], ['Google Images', 'https://www.google.com/imghp?hl=en'], ['Bing Images', 'https://www.bing.com/images'], ['Unsplash', 'https://unsplash.com/'], ['Pexels', 'https://www.pexels.com/']];
function broSize() { const sc = $('#bro-screen'); if (!sc) return null; const r = sc.getBoundingClientRect(); return { w: Math.max(320, Math.round(r.width)), h: Math.max(300, Math.round(r.height)) }; }
// keep the tab's viewport the size of the screen box, so the picture fills it edge to edge
function broFit() { if (!S.chat || !S.bro.open || S.cvMode !== 'browser' || !S.cvOpen) return; const sz = broSize(); if (sz && (!S.bro.box || sz.w !== S.bro.box.w || sz.h !== S.bro.box.h)) { S.bro.box = sz; wsSend({ t: 'bro_resize', chatId: S.chat.id, w: sz.w, h: sz.h }); } }
function broGo(url) { if (!S.chat) return toast('Open a chat first; the browser belongs to a chat.', true); S.bro.error = ''; const sz = broSize() || { w: 1000, h: 700 }; S.bro.box = sz; wsSend({ t: 'bro_nav', chatId: S.chat.id, url, w: sz.w, h: sz.h }); S.bro.open = true; renderBrowserView(); }
function renderBrowserView() {
  const body = $('#cv-body'), tabs = $('#cv-tabs'); tabs.innerHTML = ''; body.classList.add('bro-mode');
  const hadFocus = document.activeElement && document.activeElement.id === 'bro-screen';
  const b = S.bro;
  body.innerHTML = `<div class="bro"><div class="bro-bar"><button class="bro-btn" id="bro-back" title="Back">${BRO_SVG.back}</button><button class="bro-btn" id="bro-fwd" title="Forward">${BRO_SVG.fwd}</button><button class="bro-btn" id="bro-reload" title="Reload">${BRO_SVG.reload}</button><form class="bro-url" id="bro-form"><span class="g">${BRO_SVG.globe}</span><input id="bro-url" spellcheck="false" autocomplete="off" placeholder="Search Google or type a URL" value="${esc(b.url && b.url !== 'about:blank' ? b.url : '')}"></form><button class="bro-btn pick${b.pick ? ' on' : ''}" id="bro-pick" title="Save a picture as a reference: turn this on and click any picture (or Alt+click a picture any time)">${BRO_SVG.pick}<span>Pick</span></button></div><div class="bro-screen${b.pick ? ' picking' : ''}" id="bro-screen" tabindex="0">${b.open && b.frame ? `<img id="bro-img" src="data:image/jpeg;base64,${b.frame}" alt="" draggable="false">` : b.open ? `<div class="bro-start"><span class="spin"></span><span>Opening…</span></div>` : `<div class="bro-start"><b>Browse for references</b><span>Pick a site below or type a search above and the tab opens here. With Pick on (or Alt held), clicking any picture saves it as a reference.</span>${b.error ? `<div class="bro-err">${esc(b.error)}</div>` : ''}<div class="bro-links">${BRO_LINKS.map(([n, u]) => `<button class="bro-link" data-u="${esc(u)}">${esc(n)}</button>`).join('')}</div></div>`}${b.pick && b.open ? '<div class="bro-hint">Click a picture to save it · Esc to stop picking</div>' : ''}</div></div>`;
  mountIcons(body);
  $('#bro-back', body).onclick = () => wsSend({ t: 'bro_back', chatId: S.chat.id });
  $('#bro-fwd', body).onclick = () => wsSend({ t: 'bro_forward', chatId: S.chat.id });
  $('#bro-reload', body).onclick = () => { if (S.bro.open) wsSend({ t: 'bro_reload', chatId: S.chat.id }); else broGo($('#bro-url').value || 'https://www.google.com/'); };
  $('#bro-form', body).onsubmit = (e) => { e.preventDefault(); const v = $('#bro-url').value.trim(); if (v) broGo(v); $('#bro-screen').focus(); };
  $('#bro-url', body).onkeydown = (e) => { e.stopPropagation(); if (isCloseKey(e)) { e.preventDefault(); closeBrowserTab(); return; } if (e.key === 'Escape') { e.target.blur(); $('#bro-screen').focus(); } };
  $('#bro-url', body).onfocus = (e) => e.target.select();
  $('#bro-pick', body).onclick = () => { S.bro.pick = !S.bro.pick; renderBrowserView(); if (S.bro.pick) $('#bro-screen').focus(); };
  for (const l of $$('.bro-link', body)) l.onclick = () => broGo(l.dataset.u);
  wireBroScreen($('#bro-screen', body));
  if (hadFocus) $('#bro-screen', body).focus();
  if (b.open) requestAnimationFrame(broFit);
}
// mouse and keyboard on the screen go to the tab, scaled from screen pixels to page pixels
function wireBroScreen(scr) {
  const pos = (e) => { const im = $('#bro-img'); const r = (im || scr).getBoundingClientRect(); const sx = S.bro.w / r.width, sy = S.bro.h / r.height; return { x: Math.max(0, Math.min(S.bro.w, (e.clientX - r.left) * sx)), y: Math.max(0, Math.min(S.bro.h, (e.clientY - r.top) * sy)) }; };
  const send = (ev) => { if (S.bro.open && S.chat) wsSend({ t: 'bro_input', chatId: S.chat.id, ev }); };
  let lastMove = 0;
  scr.onpointermove = (e) => { if (!S.bro.open) return; const now = performance.now(); if (now - lastMove < 33) return; lastMove = now; send({ k: 'move', ...pos(e) }); };
  scr.onpointerdown = (e) => {
    if (!S.bro.open) return; scr.focus(); e.preventDefault();
    if ((S.bro.pick || e.altKey) && e.button === 0) { const p = pos(e); wsSend({ t: 'bro_pick', chatId: S.chat.id, x: p.x, y: p.y }); toast('Saving that picture…'); return; }
    send({ k: 'down', button: e.button, ...pos(e) });
  };
  scr.onpointerup = (e) => { if (!S.bro.open || S.bro.pick) return; send({ k: 'up', button: e.button, ...pos(e) }); };
  scr.onwheel = (e) => { if (!S.bro.open) return; e.preventDefault(); send({ k: 'wheel', dx: Math.round(e.deltaX), dy: Math.round(e.deltaY), ...pos(e) }); };
  scr.oncontextmenu = (e) => e.preventDefault();
  scr.onkeydown = (e) => {
    e.stopPropagation();
    if (isCloseKey(e)) { e.preventDefault(); closeBrowserTab(); return; }
    if (e.key === 'Escape' && S.bro.pick) { e.preventDefault(); S.bro.pick = false; renderBrowserView(); $('#bro-screen').focus(); return; }
    if (!S.bro.open) return;
    if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); $('#bro-url').focus(); return; }
    e.preventDefault(); send({ k: 'keydown', key: e.key });
  };
  scr.onkeyup = (e) => { e.stopPropagation(); if (!S.bro.open) return; e.preventDefault(); send({ k: 'keyup', key: e.key }); };
  scr.onpaste = (e) => { const t = e.clipboardData?.getData('text'); if (t && S.bro.open) { e.preventDefault(); send({ k: 'text', text: t }); } };
}
// ---------------------------------------------------------------- the Blender panel
// The real Blender, mirrored into the panel (Windows) or screenshotted through its Python bridge (Mac), opened on the
// chat's newest previz scene. The mouse goes to the window (click, drag, wheel); a few keys and the transport go
// through the bridge; the pop-out brings the real window to the front.
const BL_SVG = {
  play: VC_SVG.play, pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM19 5 9 12l10 7z"/></svg>', next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM5 5l10 7-10 7z"/></svg>',
  pop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  reload: BRO_SVG.reload, close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};
// The real window is a comfortable size (Blender's UI needs room); the panel shows it scaled to its width, and the
// pointer maps back through the picture's own box. Widen the panel (or pop out) to read the small text.
function blFileName() { return (S.bl.file || '').split(/[\\/]/).pop() || ''; }
// Where the real Blender window goes: the panel's area in CSS px of the viewport, plus what the helper needs to find
// this app window on the screen (its title, position and sizes) and to turn CSS px into screen pixels.
function blHost() {
  const sc = $('#bl-screen'); if (!sc) return null;
  const r = sc.getBoundingClientRect(); if (r.width < 40 || r.height < 40) return null;
  // Pinch zoom (a touchpad pinch, Ctrl+wheel on a precision touchpad) magnifies the visual viewport without changing the
  // layout: devicePixelRatio, innerWidth and the rect all stay the same while the page is seen bigger and panned. The
  // window goes where the panel is SEEN: the rect through the visual viewport's scale and offset, clipped to the window.
  const vv = window.visualViewport; const scale = vv && vv.scale > 0 ? vv.scale : 1, ox = vv ? vv.offsetLeft : 0, oy = vv ? vv.offsetTop : 0;
  const x0 = Math.max(0, (r.left - ox) * scale), y0 = Math.max(0, (r.top - oy) * scale);
  const x1 = Math.min(window.innerWidth, (r.right - ox) * scale), y1 = Math.min(window.innerHeight, (r.bottom - oy) * scale);
  if (x1 - x0 < 40 || y1 - y0 < 40) return null;   // panned out of view: the window hides until the panel is back
  return { title: document.title, dpr: window.devicePixelRatio || 1, sx: window.screenX, sy: window.screenY, ow: window.outerWidth, oh: window.outerHeight, sw: screen.width, sh: screen.height, vw: window.innerWidth, vh: window.innerHeight, x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}
function blOpen(file) { if (!S.chat) return toast('Open a chat first; Blender belongs to a chat.', true); S.bl.opening = true; S.bl.error = ''; renderBlenderView(); wsSend({ t: 'bl_open', chatId: S.chat.id, file: file || '', host: blHost() }); }
// A clip card's Blender icon: that card's scene in the panel. The chat's Blender loads the file if it is open; otherwise it opens on it.
function blOpenScene(blend) {
  if (!S.chat) return toast('Open a chat first; Blender belongs to a chat.', true);
  if (!S.connections?.blender?.connected) return toast('Blender is not connected (See more > Connections).', true);
  S.cvMode = 'blender'; S.cvJob = null; toggleCV(true);
  if (S.bl.open) { if (S.bl.file !== blend) { S.bl.file = blend; blControl({ k: 'open', path: blend }); renderBlenderView(); toast('Blender is loading ' + blend.split(/[\/]/).pop()); } }
  else blOpen(blend);
}
function blControl(c) { if (S.chat && S.bl.open) wsSend({ t: 'bl_control', chatId: S.chat.id, c }); }
// Keeps the real window exactly over the panel, and only while the Blender tab is what the user is looking at
// (hidden behind a chat switch, another tab, a closed panel, the lightbox, Settings or the docs). Runs on a short
// timer because the panel's place changes with layout, not with any one event.
let blLastKey = '', blShownChat = '', blPlacedAt = 0, blMisses = 0, blGestureAt = 0;
// A zoom (pinch, Ctrl+wheel) or a window resize is a stream of changes; a real window can only chase them late and would
// trail outside the panel. Like the panel drag, the window hides while the gesture is going and comes back where it ends.
const blGesture = () => { blGestureAt = Date.now(); };
window.addEventListener('resize', blGesture);
if (window.visualViewport) { window.visualViewport.addEventListener('resize', blGesture); window.visualViewport.addEventListener('scroll', blGesture); }
function blSync() {
  const cur = S.chat?.id || '';
  if (blShownChat && blShownChat !== cur) { wsSend({ t: 'bl_vis', chatId: blShownChat, on: false }); blShownChat = ''; blLastKey = ''; }
  if (!cur || !S.bl.open || !S.bl.embed) { if (blShownChat === cur && cur && !S.bl.open) { blShownChat = ''; blLastKey = ''; } return; }
  // while the panel edge is being dragged the Blender window would trail the panel and spill over the chat: hide it, show it again where the drag ends
  const covered = $('#lightbox').classList.contains('on') || $('#settings').classList.contains('on') || $('#docs').classList.contains('on') || document.body.classList.contains('cv-dragging') || Date.now() - blGestureAt < 300;
  const want = S.cvOpen && S.cvMode === 'blender' && !S.cvJob && S.view === 'chat' && !covered && !document.hidden;
  const host = want ? blHost() : null;
  const key = cur + '|' + (host ? JSON.stringify(host) : 'off');
  if (key === blLastKey) {
    // nothing changed on the page, so the window must be the panel's size by now (browser zoom, a drag, a layout change
    // all went through bl_place). When it is not, a message was lost or the helper stalled: place it again, and after
    // three misses have the server restart the helper on the same Blender.
    if (host && S.bl.placed && Date.now() - blPlacedAt > 900) {
      const ew = Math.round(host.w * host.dpr), eh = Math.round(host.h * host.dpr);
      if (Math.abs(S.bl.placed.w - ew) > 3 || Math.abs(S.bl.placed.h - eh) > 3) {
        blMisses++; blPlacedAt = Date.now();
        if (blMisses >= 3) { blMisses = 0; wsSend({ t: 'bl_recast', chatId: cur, host }); }
        else { wsSend({ t: 'bl_place', chatId: cur, host }); wsSend({ t: 'bl_vis', chatId: cur, on: true }); }
      } else blMisses = 0;
    }
    return;
  }
  blLastKey = key; blPlacedAt = Date.now(); blMisses = 0;
  if (host) wsSend({ t: 'bl_place', chatId: cur, host });
  wsSend({ t: 'bl_vis', chatId: cur, on: Boolean(host) });
  blShownChat = host ? cur : '';
}
setInterval(() => { try { blSync(); } catch { /* not ready */ } }, 200);
window.addEventListener('beforeunload', () => { if (blShownChat) wsSend({ t: 'bl_vis', chatId: blShownChat, on: false }); });
// After a reload the server may still hold this chat's Blender: pick it up once.
async function blRecover() {
  if (!S.chat || S.bl.open || S.bl.opening || S.bl.checked === S.chat.id) return;
  S.bl.checked = S.chat.id;
  const r = await api('/api/blender/' + encodeURIComponent(S.chat.id)).catch(() => null);
  if (r && r.open && S.chat && S.bl.checked === S.chat.id) { S.bl.open = true; S.bl.embed = r.embed !== false; S.bl.file = r.file || ''; S.bl.version = r.version || ''; if (S.cvOpen) { renderCVModes(); if (S.cvMode === 'blender') renderBlenderView(); } }
}
function renderBlenderView() {
  const body = $('#cv-body'), tabs = $('#cv-tabs'); tabs.innerHTML = ''; body.classList.add('bro-mode');
  const b = S.bl; const st = b.state;
  const con = S.connections?.blender;
  const latest = latestPrevizPath();
  const embed = b.embed !== false;
  body.innerHTML = `<div class="bro bl"><div class="bro-bar">
      <span class="bl-file" title="${esc(b.file || '')}">${b.open ? `<img src="logos/blender.svg" alt="">${esc(blFileName() || 'Blender')}` : `<img src="logos/blender.svg" alt="">Blender${con?.version ? ' ' + esc(con.version) : ''}`}</span>
      <span class="grow"></span>
      ${b.open ? `<button class="bro-btn" id="bl-close" title="Close Blender">${BL_SVG.close}<span>Close</span></button>` : ''}
    </div>
    <div class="bro-screen bl-screen${b.open ? ' on' : ''}${embed ? ' embed' : ''}" id="bl-screen" tabindex="0">${b.open && embed ? `<div class="bl-under"><img class="bl-logo dim" src="logos/blender.svg" alt=""><span>Blender is open here</span></div>` : b.open && b.frame ? `<img id="bl-img" src="data:image/${b.kind};base64,${b.frame}" alt="" draggable="false">` : b.open || b.opening ? `<div class="bro-start"><span class="spin"></span><span>${b.opening ? 'Opening Blender…' : 'Waiting for the first picture…'}</span></div>` : `<div class="bro-start"><img class="bl-logo" src="logos/blender.svg" alt=""><b>Blender${con?.version ? ' ' + esc(con.version) : ''} is connected</b><span>${latest ? 'Open the newest Blender scene here. The whole of Blender runs inside this panel: model, animate, scrub the timeline, render.' : 'When the agent builds a Blender clip in this chat, open it here and watch the scene. Until then this opens an empty Blender inside the panel.'}</span>${b.error ? `<div class="bro-err">${esc(b.error)}</div>` : ''}<div class="bro-links"><button class="bro-link lime" id="bl-open">Open Blender</button></div></div>`}</div>
    ${b.open && !embed ? `<div class="bl-bar">
      <button class="bro-btn" id="bl-start" title="First frame">${BL_SVG.prev}</button>
      <button class="bro-btn" id="bl-play" title="Play / pause (Space)">${st?.playing ? BL_SVG.pause : BL_SVG.play}</button>
      <button class="bro-btn" id="bl-end" title="Last frame">${BL_SVG.next}</button>
      <input type="range" id="bl-scrub" min="${st?.start || 1}" max="${st?.end || 250}" value="${st?.frame || 1}">
      <span class="bl-frame" id="bl-frame">${st ? `${st.frame} / ${st.end}` : ''}</span>
      <span class="bl-views"><button class="bro-btn" data-view="camera" title="Camera view (Numpad 0)">Cam</button><button class="bro-btn" data-view="top" title="Top (Numpad 7)">Top</button><button class="bro-btn" data-view="front" title="Front (Numpad 1)">Front</button><button class="bro-btn" data-view="right" title="Right (Numpad 3)">Right</button><button class="bro-btn" data-view="all" title="Frame everything (Home)">All</button></span>
    </div><div class="bl-hint">Drag orbits · Shift+drag pans · wheel zooms · Space, ← →, Numpad 0/1/3/7 work from here</div>` : ''}
  </div>`;
  mountIcons(body);
  const openBtn = $('#bl-open', body); if (openBtn) openBtn.onclick = () => blOpen(latest || '');
  const close = $('#bl-close', body); if (close) close.onclick = () => wsSend({ t: 'bl_close', chatId: S.chat.id });
  const play = $('#bl-play', body); if (play) play.onclick = () => blControl({ k: 'playtoggle' });
  const start = $('#bl-start', body); if (start) start.onclick = () => blControl({ k: 'jumpend', to: 'start' });
  const end = $('#bl-end', body); if (end) end.onclick = () => blControl({ k: 'jumpend', to: 'end' });
  const scrub = $('#bl-scrub', body); if (scrub) scrub.oninput = () => { blControl({ k: 'frame', n: Number(scrub.value) }); const f = $('#bl-frame'); if (f && S.bl.state) f.textContent = `${scrub.value} / ${S.bl.state.end}`; };
  for (const v of $$('[data-view]', body)) v.onclick = () => { blControl({ k: 'view', v: v.dataset.view }); $('#bl-screen')?.focus(); };
  if (!embed) wireBlScreen($('#bl-screen', body));
  if (!b.open && !b.opening) blRecover();
  blLastKey = ''; blSync();
}
function updateBlTransport() {
  const st = S.bl.state; if (!st) return;
  const scrub = $('#bl-scrub'); if (scrub && document.activeElement !== scrub) { scrub.min = st.start; scrub.max = st.end; scrub.value = st.frame; }
  const f = $('#bl-frame'); if (f) f.textContent = `${st.frame} / ${st.end}`;
  const play = $('#bl-play'); if (play) play.innerHTML = st.playing ? BL_SVG.pause : BL_SVG.play;
  const name = $('.bl-file'); if (name && S.bl.file) { name.title = S.bl.file; name.innerHTML = `<img src="logos/blender.svg" alt="">${esc(blFileName())}`; }
}
// The newest .blend the chat's agent produced (from its previz cards), for the Open and Reload buttons.
function latestPrevizPath() {
  if (!S.chat) return '';
  const cards = S.chat.messages.flatMap((m) => m.role === 'assistant' ? (m.blocks || []).filter((b) => b.kind === 'image' && b.previz && b.path) : []);
  const last = cards[cards.length - 1]; return last ? last.path.replace(/\.mp4$/i, '.blend') : '';
}
// The Mac picture: drags become orbit / pan through the bridge, keys go through it too.
function wireBlScreen(scr) {
  if (!scr) return;
  const send = (ev) => { if (S.bl.open && S.chat) wsSend({ t: 'bl_input', chatId: S.chat.id, ev }); };
  let lastMove = 0, drag = null;
  scr.onpointermove = (e) => {
    if (!S.bl.open || !drag) return; const now = performance.now(); if (now - lastMove < 30) return; lastMove = now;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY, pan: drag.pan }; send({ k: drag.pan ? 'pan' : 'orbit', dx, dy });
  };
  scr.onpointerdown = (e) => { if (!S.bl.open) return; scr.focus(); e.preventDefault(); scr.setPointerCapture?.(e.pointerId); drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey }; };
  scr.onpointerup = () => { drag = null; };
  scr.onwheel = (e) => { if (!S.bl.open) return; e.preventDefault(); send({ k: 'wheel', dy: Math.round(e.deltaY) }); };
  scr.oncontextmenu = (e) => e.preventDefault();
  scr.onkeydown = (e) => {
    e.stopPropagation();
    if (isCloseKey(e)) { e.preventDefault(); return; }
    if (!S.bl.open) return;
    const code = e.code || ''; let key = '';
    if (/^Numpad[01357]$/.test(code)) key = code.toLowerCase(); else if (code === 'NumpadDecimal') key = 'numpad.'; else if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'Escape', 'z', 'Z'].includes(e.key)) key = e.key.toLowerCase();
    if (!key) return;
    e.preventDefault(); send({ k: 'key', key, shift: e.shiftKey, ctrl: e.ctrlKey });
  };
}

// The pictures the scout brought back, one section per thing: tap to keep or drop, then Approve or Keep searching for all of them.
function renderRefsView() {
  const body = $('#cv-body'), tabs = $('#cv-tabs'); tabs.innerHTML = '';
  const sets = reviewRefs();
  if (!sets.length) { body.innerHTML = `<div class="cv-empty">${icon('view_grid')}<b>No references yet</b><span>Say yes when the agent offers to find references and they show up here.</span></div>`; mountIcons(body); return; }
  const anyOpen = sets.some((b) => b.status === 'open');
  const statusOf = (b, sel) => b.status === 'searching' ? 'Looking…' : b.status === 'decided' ? (b.decision === 'approve' ? `Approved ${b.items.filter((i) => i.keep !== false).length} of ${b.items.length}` : `Kept ${b.items.filter((i) => i.keep !== false).length}, looking for more`) : b.status === 'empty' ? 'Nothing usable found' : b.status === 'error' ? (b.error || 'Could not browse') : `${b.items.length} found${b.stopped ? ' before you stopped it' : ''} · ${sel.size} kept`;
  let total = 0;
  body.innerHTML = sets.map((b) => {
    const open = b.status === 'open'; const sel = refsSelFor(b); if (open) total += sel.size;
    return `<section class="refs-set" data-b="${b.id}"><div class="refs-head${b.status === 'searching' ? ' glow-ring' : ''}"><div><b>${esc(b.label ? `References for ${b.label}` : 'References')}</b><span>${esc(statusOf(b, sel))}</span></div>${b.query ? `<small>“${esc(b.query)}”</small>` : ''}${open && b.picked ? `<button class="hb rs-dismiss" data-dismiss="${b.id}" title="Remove every pick in this set">${icon('close_x')}Remove set</button>` : ''}</div>${b.items.length ? `<div class="refs-grid">${b.items.map((i) => `<button class="ref${(open ? sel.has(i.n) : i.keep !== false) ? ' keep' : ' drop'}" data-n="${i.n}" title="${esc(i.title || i.source)}"><img src="${fileUrl(i.path)}" alt="" loading="lazy"><span class="num">${i.n}</span><span class="src">${esc(i.source)}</span><span class="mark">${icon('check')}</span><span class="markx">${icon('close_x')}</span>${open && b.picked ? `<span class="rm" data-rm="${i.n}" title="Remove this pick">${icon('close_x')}</span>` : ''}</button>`).join('')}</div>` : ''}${open && b.picked && !b.items.length ? '<div class="refs-none">No picks yet. Turn Pick on in the browser and click a picture.</div>' : ''}</section>`;
  }).join('') + (anyOpen ? `<div class="refs-acts"><button class="btn ghost" id="refs-keep">${icon('search')}Keep searching</button><button class="btn lime" id="refs-ok">${icon('check')}Approve <span class="cnt">${total}</span></button></div>` : '');
  mountIcons(body);
  if (anyOpen) body.querySelector('.refs-set:last-of-type')?.classList.add('last');
  for (const sec of $$('.refs-set', body)) {
    const b = sets.find((x) => x.id === sec.dataset.b); const open = b.status === 'open'; const sel = refsSelFor(b);
    for (const el of $$('.ref[data-n]', sec)) {
      const n = Number(el.dataset.n); const item = b.items.find((i) => i.n === n);
      el.onclick = () => { if (!open) return lightbox(fileUrl(item.path), item.path); if (sel.has(n)) sel.delete(n); else sel.add(n); renderRefsView(); };
      el.oncontextmenu = (e) => { e.preventDefault(); lightbox(fileUrl(item.path), item.path); };
      const rm = $('.rm', el); if (rm) rm.onclick = (e) => { e.stopPropagation(); removeRef(b, n); };
    }
    const dis = $('.rs-dismiss', sec); if (dis) dis.onclick = () => dismissPicks(b);
  }
  const ok = $('#refs-ok', body), more = $('#refs-keep', body);
  if (ok) ok.onclick = () => decideRefs(sets.filter((b) => b.status === 'open'), 'approve'); if (more) more.onclick = () => decideRefs(sets.filter((b) => b.status === 'open'), 'keep');
}
// Take a picked reference out of its set (and off the disk). The server patches the card; the view follows.
async function removeRef(block, n) {
  const r = await api('/api/refs/remove', { method: 'POST', body: { chatId: S.chat.id, blockId: block.id, n } }).catch(() => null);
  if (!r) return toast('Could not remove that.', true);
  const sel = refsSelFor(block); sel.delete(n);
  Object.assign(block, { items: r.items, status: r.items.length || !block.picked ? 'open' : 'empty' });
  const turn = S.chat.messages.find((m) => m.role === 'assistant' && (m.blocks || []).includes(block)); if (turn) renderBlock(turn, block);
  if (S.cvOpen && S.cvMode === 'refs') renderRefsView(); renderCVModes();
  toast('Reference removed');
}
async function dismissPicks(block) {
  const r = await api('/api/refs/dismiss', { method: 'POST', body: { chatId: S.chat.id, blockId: block.id } }).catch(() => null);
  if (!r) return toast('Could not remove that set.', true);
  if (S.refsSel) delete S.refsSel[block.id];
  Object.assign(block, { items: [], status: 'empty', dismissed: true });
  const turn = S.chat.messages.find((m) => m.role === 'assistant' && (m.blocks || []).includes(block)); if (turn) renderBlock(turn, block);
  if (S.cvOpen && S.cvMode === 'refs') renderRefsView(); renderCVModes();
  toast('Picks removed');
}
async function decideRefs(blocks, decision) {
  const plan = blocks.map((b) => ({ b, keep: [...refsSelFor(b)].sort((x, y) => x - y) }));
  const keptTotal = plan.reduce((n, p) => n + p.keep.length, 0);
  if (decision === 'approve' && !keptTotal && !confirm('Approve with none kept? The agent will generate without references.')) return;
  const texts = [], human = [];
  for (const p of plan) {
    const r = await api('/api/refs/decide', { method: 'POST', body: { chatId: S.chat.id, blockId: p.b.id, decision, keep: p.keep } }).catch(() => null);
    if (!r) return toast('Could not send that.', true);
    texts.push(r.text);
    const name = p.b.label || p.b.query || 'references'; const dropped = p.b.items.length - p.keep.length;
    human.push(decision === 'approve' ? (p.keep.length ? `${name}: use ${p.keep.join(', ')}` : `${name}: none`) : `${name}: keep ${p.keep.length ? p.keep.join(', ') : 'none'}, find ${dropped || p.b.need} more`);
    Object.assign(p.b, { status: 'decided', decision, items: p.b.items.map((i) => ({ ...i, keep: p.keep.includes(i.n) })) });
    const turn = S.chat.messages.find((m) => m.role === 'assistant' && (m.blocks || []).includes(p.b)); if (turn) renderBlock(turn, p.b);
  }
  renderRefsView(); renderCVModes();
  sendOrQueue(texts.join('\n\n'), (decision === 'approve' ? 'References approved. ' : 'Keep searching. ') + human.join('. ') + '.');
  toast(decision === 'approve' ? (keptTotal ? `Using ${keptTotal} reference${keptTotal === 1 ? '' : 's'}` : 'Generating without references') : 'Asked the agent to keep looking');
}
async function renderCV() {
  const tabs = $('#cv-tabs'), body = $('#cv-body');
  $('#cv-job .mtxt').textContent = S.cvJob || 'Chat History';
  renderCVModes();
  body.classList.remove('bro-mode');
  if (!S.cvJob && S.cvMode === 'browser') return renderBrowserView();
  if (!S.cvJob && S.cvMode === 'refs') return renderRefsView();
  if (!S.cvJob && S.cvMode === 'blender') return renderBlenderView();
  let media = [];
  if (S.cvJob) { const j = await api('/api/jobs/' + encodeURIComponent(S.cvJob)).catch(() => null); media = j?.media || []; }
  else if (S.chat) {
    const gens = S.chat.messages.flatMap((m) => m.role === 'assistant' ? m.blocks.filter((b) => b.kind === 'image') : []).reverse();
    if (!gens.length) { tabs.innerHTML = ''; body.innerHTML = `<div class="cv-empty">${icon('project_folder')}<b>Start generating</b><span>Ask Supercomputer anything</span></div>`; return; }
    tabs.innerHTML = `<button class="cv-tab active">All</button>`;
    body.innerHTML = `<div class="cv-gens">${gens.map((b) => {
      const pending = !b.path && b.status !== 'failed';
      if (!b.path) return `<div class="cv-gen ${pending ? 'pending' : 'failed'}" data-bid="${b.id}">${pending ? `<span class="pill-state">${b.waiting ? '' : '<span class="spin"></span>'}${b.waiting ? 'Awaiting approval' : b.status === 'processing' ? 'Processing' : 'Queued'}</span><button class="cancel" data-cancel="1">${icon('close_x')}Cancel</button>` : `<span class="pill-state warn">${icon('warning')}Failed</span><div class="err">${esc(b.error || '')}</div>`}</div>`;
      const approved = b.decision === 'approve' || /approved/.test(b.path);
      return `<button class="cv-gen" data-p="${esc(b.path)}"><span class="chk"></span>${b.video ? `<video src="${fileUrl(b.path)}" muted></video>` : `<img src="${fileUrl(b.path)}" alt="" loading="lazy">`}<span class="cap">${esc(b.item || b.path.split(/[\\/]/).pop())}${b.version ? ' · ' + esc(b.version) : ''}${approved ? '<span class="pill lime">approved</span>' : ''}</span></button>`;
    }).join('')}</div>`;
    mountIcons(body);
    for (const el of $$('.cv-gen[data-p]', body)) el.onclick = () => lightbox(fileUrl(el.dataset.p), el.dataset.p);
    for (const el of $$('[data-cancel]', body)) el.onclick = () => { stopTurn(); toast('Stopping the run'); };
    return;
  }
  const groups = [...new Set(media.map((m) => m.item || 'other'))];
  tabs.innerHTML = `<button class="cv-tab${!S.cvTab ? ' active' : ''}" data-tab="">All</button>` + groups.map((g) => `<button class="cv-tab${S.cvTab === g ? ' active' : ''}" data-tab="${esc(g)}">${esc(g)}</button>`).join('');
  for (const t of $$('.cv-tab', tabs)) t.onclick = () => { S.cvTab = t.dataset.tab; renderCV(); };
  let list = media.filter((m) => !S.cvTab || (m.item || 'other') === S.cvTab); if (S.cvFilter === 'approved') list = list.filter((m) => m.approved);
  if (!list.length) { body.innerHTML = `<div class="cv-empty">${icon('project_folder')}<b>Start generating</b><span>Ask Supercomputer anything</span></div>`; return; }
  body.innerHTML = `<div class="cv-grid ${S.cvView}">${list.map((m) => `<button class="cv-item" data-p="${esc(m.path)}">${m.video ? `<video src="${fileUrl(m.path)}" muted></video>` : `<img src="${fileUrl(m.path)}" alt="" loading="lazy">`}${m.approved ? `<span class="pill lime ap">approved</span>` : ''}<span class="nm">${esc(m.rel || m.name)}</span></button>`).join('')}</div>`;
  for (const b of $$('.cv-item', body)) b.onclick = () => lightbox(fileUrl(b.dataset.p), b.dataset.p);
}
function lightbox(src, cap) { const lb = $('#lightbox'); $('#lb-media').innerHTML = isVideo(cap) ? `<video src="${src}" controls autoplay playsinline></video>` : `<img src="${src}" alt="">`; $('#lb-cap').textContent = cap || ''; lb.classList.add('on'); }

// ---------------------------------------------------------------- pages (skills, projects, library, briefs)
async function openPage(name) {
  S.page = name; setView('page'); $('#tb-title').hidden = true; renderChats();
  const inner = $('#page-inner'); inner.innerHTML = '';
  if (name === 'skills') {
    inner.appendChild(h(`<div class="page-hero"><div><h1>Explore skills</h1><p>Skills and roles the pipeline can load. They live in the Leo Workflow folder. Upload a Markdown skill and use it in any chat by name.</p></div><div class="acts"><button class="btn ghost" id="pg-upload">${icon('plus')}Upload skill</button><button class="btn lime" id="pg-new">Create new</button></div></div>`));
    inner.appendChild(h(`<div class="page-tools"><div class="search">${icon('search')}<input id="pg-search" placeholder="Search skills"></div><span class="pill grey">${S.skills.length} available</span></div>`));
    const grid = h('<div class="cards" id="pg-grid"></div>'); inner.appendChild(grid);
    const draw = (f = '') => { grid.innerHTML = ''; const list = S.skills.filter((s) => !f || (s.name + ' ' + s.description).toLowerCase().includes(f.toLowerCase())); if (!list.length) grid.appendChild(h('<div class="empty-state"><h2>No skills found</h2></div>')); list.forEach((s, i) => { const c = h(`<button class="skill-card" style="animation-delay:${Math.min(i, 12) * 25}ms"><div class="top"><span class="chip">${icon(s.kind === 'role' ? 'loaded_skills' : 'h_skills_bolt')}</span><div><div class="nm">${esc(s.name)}</div><div class="path">${esc(s.kind)}</div></div></div><div class="ds">${esc(s.description || 'No description')}</div><div class="path">${esc(s.path)}</div></button>`); c.onclick = () => { goHome(); $('#home-editor').textContent = s.kind === 'role' ? `Deploy the ${s.name} role: ` : `Use the ${s.name} skill: `; placeCaretEnd($('#home-editor')); updateSend('home'); }; grid.appendChild(c); }); mountIcons(grid); };
    draw(); $('#pg-search', inner).oninput = (e) => draw(e.target.value);
    $('#pg-new', inner).onclick = () => { goHome(); $('#home-editor').textContent = 'Create a new skill in .claude/skills/ that '; placeCaretEnd($('#home-editor')); updateSend('home'); };
    $('#pg-upload', inner).onclick = () => $('#skill-file').click();
  } else if (name === 'projects') {
    inner.appendChild(h(`<div class="page-hero"><div><h1>Projects</h1><p>Every job folder in the pipeline. Open one in the content viewer or resume it in a chat.</p></div><button class="btn lime" id="pg-new">New project</button></div>`));
    inner.appendChild(h(`<div class="page-tools"><div class="tabs" style="margin:0"><button class="tab active">All</button><button class="tab">With approved</button><button class="tab">Empty</button></div><div class="search">${icon('search')}<input id="pg-search" placeholder="Search projects"></div></div>`));
    const grid = h('<div class="cards" id="pg-grid"></div>'); inner.appendChild(grid);
    let mode = 0;
    const draw = (f = '') => { grid.innerHTML = ''; let list = S.jobs.filter((j) => !f || j.name.toLowerCase().includes(f.toLowerCase())); if (mode === 1) list = list.filter((j) => j.approved); if (mode === 2) list = list.filter((j) => !j.count); if (!list.length) { grid.appendChild(h(`<div class="empty-state">${icon('project_folder')}<h2>Create your first project</h2><span>Start a chat from a brief and the pipeline creates the job folder.</span></div>`)); mountIcons(grid); return; } list.forEach((j, i) => { const c = h(`<button class="card" style="animation-delay:${Math.min(i, 12) * 30}ms"><div class="media">${j.cover ? `<img src="${fileUrl(j.cover)}" alt="" loading="lazy">` : icon('project_folder')}</div><div class="cap"><span class="chip">${icon('project_folder')}</span><div style="min-width:0"><div class="ct">${esc(j.name)}</div><div class="cs">${j.count} files · ${j.approved || 0} approved</div></div></div></button>`); c.onclick = () => { S.cvJob = j.name; toggleCV(true); }; grid.appendChild(c); }); mountIcons(grid); };
    draw(); $('#pg-search', inner).oninput = (e) => draw(e.target.value);
    $$('.tab', inner).forEach((t, i) => { t.onclick = () => { $$('.tab', inner).forEach((x) => x.classList.toggle('active', x === t)); mode = i; draw($('#pg-search', inner).value); }; });
    $('#pg-new', inner).onclick = () => { goHome(); $('#home-editor').textContent = 'Start a new job: '; placeCaretEnd($('#home-editor')); updateSend('home'); };
  } else if (name === 'library') {
    inner.appendChild(h(`<div class="page-hero"><div><h1>Library</h1><p>Everything the pipeline has rendered, newest first.</p></div></div>`));
    const grid = h('<div class="cards" id="pg-grid"></div>'); inner.appendChild(grid);
    const jobs = await Promise.all(S.jobs.slice(0, 12).map((j) => api('/api/jobs/' + encodeURIComponent(j.name)).catch(() => null)));
    const media = jobs.filter(Boolean).flatMap((j) => j.media.map((m) => ({ ...m, job: j.name }))).sort((a, b) => b.mtime - a.mtime).slice(0, 120);
    if (!media.length) grid.appendChild(h(`<div class="empty-state">${icon('project_folder')}<h2>Nothing rendered yet</h2></div>`));
    media.forEach((m, i) => { const c = h(`<button class="card" style="animation-delay:${Math.min(i, 12) * 25}ms"><div class="media">${m.video ? `<video src="${fileUrl(m.path)}" muted></video>` : `<img src="${fileUrl(m.path)}" alt="" loading="lazy">`}</div><div class="cap"><span class="chip">${icon('generation')}</span><div style="min-width:0"><div class="ct">${esc(m.rel)}</div><div class="cs">${esc(m.job)}${m.approved ? ' · approved' : ''}</div></div></div></button>`); c.onclick = () => lightbox(fileUrl(m.path), m.path); grid.appendChild(c); });
    mountIcons(grid);
  } else if (name === 'connections') {
    inner.appendChild(h(`<div class="page-hero"><div><h1>Connections</h1><p>Programs on this computer that Supercomputer can drive. Connect one and the agent uses it in every chat, from its own terminal, with no extra setup.</p></div></div>`));
    const grid = h('<div class="cards conn-grid" id="pg-grid"></div>'); inner.appendChild(grid);
    const draw = () => { grid.innerHTML = ''; const progs = Object.values(S.connections || {}); if (!progs.length) { grid.appendChild(h(`<div class="empty-state"><h2>Loading…</h2></div>`)); return; } for (const p of progs) grid.appendChild(connectionCard(p)); mountIcons(grid); };
    draw();
    if (!S.connections) loadConnections().then(draw);
    S.redrawConnections = draw;
  } else if (name === 'briefs') {
    inner.appendChild(h(`<div class="page-hero"><div><h1>Briefs</h1><p>Client briefs in the pipeline's briefs folder. Click one to start a job from it.</p></div></div>`));
    const grid = h('<div class="cards"></div>'); inner.appendChild(grid);
    if (!S.briefs.length) grid.appendChild(h(`<div class="empty-state">${icon('viewed_skill')}<h2>No briefs yet</h2><span>Drop a .md or .txt into the briefs folder.</span></div>`));
    S.briefs.forEach((b, i) => { const c = h(`<button class="skill-card" style="animation-delay:${Math.min(i, 12) * 25}ms"><div class="top"><span class="chip">${icon('viewed_skill')}</span><div><div class="nm">${esc(b.name)}</div></div></div><div class="path">${esc(b.path)}</div></button>`); c.onclick = () => { goHome(); attachPath(b.path, b.name, 'home'); $('#home-editor').textContent = 'Start a new job from this brief.'; updateSend('home'); }; grid.appendChild(c); });
    mountIcons(grid);
  }
}

async function loadConnections() {
  try { const r = await api('/api/connections'); S.connections = r.programs || {}; S.platform = r.platform || ''; } catch { S.connections = S.connections || {}; }
  if (S.cvOpen) renderCVModes();
  return S.connections;
}
// One program on the Connections page: its logo, what it does for the pipeline, and Connect / Disconnect.
function connectionCard(p) {
  const logo = p.key === 'blender' ? `<img src="logos/blender.svg" alt="">` : icon('h_connectors');
  const whatFor = p.key === 'blender' ? 'Blender clips. The agent writes Blender Python in the chat, Blender renders a low-poly clip of the camera move on this machine, and Seedance follows it. Blender also opens in the side panel so you can watch the scene.' : p.tagline;
  const card = h(`<div class="conn-card${p.connected ? ' on' : ''}"><div class="top"><span class="logo">${logo}</span><div class="grow"><div class="nm">${esc(p.name)}</div><div class="st">${p.connected ? `Connected · ${esc(p.version || '')}` : 'Not connected'}</div></div></div><div class="ds">${esc(whatFor)}</div>${p.connected ? `<div class="path" title="${esc(p.path)}">${esc(p.path)}</div>` : ''}<div class="acts">${p.connected ? `<button class="btn ghost sm" data-a="rescan">Find another</button><button class="btn ghost sm" data-a="disconnect">Disconnect</button>` : `<button class="btn lime sm" data-a="connect">${icon('plus')}Connect</button><button class="btn ghost sm" data-a="browse">Point me at the file</button><a class="btn ghost sm" href="${esc(p.url)}" target="_blank" rel="noopener">Get ${esc(p.name)}</a>`}</div><div class="conn-msg" hidden></div><div class="conn-manual" hidden><input placeholder="${S.platform === 'darwin' ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'}" spellcheck="false"><button class="btn lime sm">Use this file</button></div></div>`);
  const msg = card.querySelector('.conn-msg'); const say = (t, err) => { msg.hidden = !t; msg.textContent = t || ''; msg.classList.toggle('err', Boolean(err)); };
  const doConnect = async (path) => {
    say(path ? 'Checking that file…' : `Looking for ${p.name} on this computer…`); for (const b of card.querySelectorAll('button')) b.disabled = true;
    try { const r = await api(`/api/connections/${p.key}/connect`, { method: 'POST', body: { path: path || '' } }); S.connections[p.key] = r; toast(`${p.name} ${r.version} connected`); S.redrawConnections?.(); renderCVModes(); }
    catch (e) { for (const b of card.querySelectorAll('button')) b.disabled = false; say(e.message || 'Could not connect.', true); card.querySelector('.conn-manual').hidden = false; }
  };
  const a = (k) => card.querySelector(`[data-a="${k}"]`);
  if (a('connect')) a('connect').onclick = () => doConnect('');
  if (a('rescan')) a('rescan').onclick = async () => { say('Looking for every install…'); try { const r = await api(`/api/connections/${p.key}/scan`, { method: 'POST', body: {} }); const found = r.found || []; if (!found.length) return say('Nothing else found.', true); say(`Found ${found.length}: ` + found.map((f) => `${f.version} at ${f.path}`).join(' · ')); card.querySelector('.conn-manual').hidden = false; } catch (e) { say(e.message, true); } };
  if (a('disconnect')) a('disconnect').onclick = async () => { try { const r = await api(`/api/connections/${p.key}`, { method: 'DELETE' }); S.connections[p.key] = r; toast(`${p.name} disconnected`); S.redrawConnections?.(); if (S.cvMode === 'blender') S.cvMode = 'history'; renderCVModes(); if (S.cvOpen) renderCV(); } catch (e) { say(e.message, true); } };
  if (a('browse')) a('browse').onclick = () => { const m = card.querySelector('.conn-manual'); m.hidden = !m.hidden; if (!m.hidden) m.querySelector('input').focus(); };
  const man = card.querySelector('.conn-manual'); man.querySelector('.btn').onclick = () => { const v = man.querySelector('input').value.trim(); if (v) doConnect(v); }; man.querySelector('input').onkeydown = (e) => { if (e.key === 'Enter') man.querySelector('.btn').click(); };
  return card;
}

// ---------------------------------------------------------------- settings + credits
async function refreshCredits(announce) {
  const p = curProvider();
  try {
    const c = await api('/api/credits?provider=' + p); S.credits = c;
    $('#tb-credits').title = `${PROV_NAME[p]} · ${providerStatus(p, c)}`;
    if (!c.ok) { $('#tb-credits-txt').textContent = S.config.keys?.[p] ? PROV_NAME[p] : 'No key'; $('#sb-credits-pill').textContent = S.config.keys?.[p] ? 'check key' : 'add key'; $('#tb-credits-bar').style.width = '0'; if (announce) openSettings(); return; }
    if (p === 'elevenlabs') {
      const left = Math.max(0, (c.limit || 0) - (c.used || 0)); $('#tb-credits-txt').textContent = left.toLocaleString(); $('#sb-credits-pill').textContent = String(c.tier || 'plan').split('_')[0]; $('#sb-credits-pill').title = `${c.tier || ''} plan · ${left.toLocaleString()} credits left`;
      $('#tb-credits-bar').style.width = `${c.limit ? Math.round((left / c.limit) * 100) : 0}%`;
      if (announce) toast(`ElevenLabs: ${left.toLocaleString()} of ${(c.limit || 0).toLocaleString()} credits left${c.resetUnix ? `, resets ${new Date(c.resetUnix * 1000).toLocaleDateString()}` : ''}`);
    } else {
      const has = c.balance != null;
      $('#tb-credits-txt').textContent = has ? (p === 'fal' ? `$${Number(c.balance).toFixed(2)}` : Number(c.balance).toLocaleString()) : PROV_NAME[p]; $('#sb-credits-pill').textContent = PROV_NAME[p]; $('#sb-credits-pill').title = providerStatus(p, c);
      $('#tb-credits-bar').style.width = has && c.start ? `${Math.max(0, Math.min(100, Math.round((c.balance / c.start) * 100)))}%` : has ? '100%' : '0';
      if (announce) toast(`${PROV_NAME[p]}: ${providerStatus(p, c)}`);
    }
  } catch { $('#tb-credits-txt').textContent = '—'; }
}
// Native <select> boxes look foreign here; each becomes a trigger + the app's own menu. The <select> stays in the
// DOM (hidden) so code that reads .value keeps working.
function upgradeSelects(root = document) {
  for (const sel of $$('select', root)) {
    if (sel.dataset.upgraded) continue; sel.dataset.upgraded = '1'; sel.hidden = true;
    const btn = h(`<button type="button" class="trigger field"><span class="mtxt"></span><span class="chev">${icon('chevron_down')}</span></button>`);
    const label = () => { btn.querySelector('.mtxt').textContent = sel.options[sel.selectedIndex]?.textContent || ''; };
    label(); sel.after(btn); mountIcons(btn);
    btn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (S.menu?.anchor === btn) return closeMenu();
      const el = openMenu(btn, 'pick', [...sel.options].map((o) => `<button class="mrow slim" data-v="${esc(o.value)}"><span class="id"><span class="col"><span class="nm"><span>${esc(o.textContent)}</span></span></span></span><span class="right">${o.selected ? `<span class="chk">${icon('check')}</span>` : ''}</span></button>`).join(''), { above: false, align: 'right' });
      for (const b of $$('.mrow', el)) b.onclick = (ev) => { ev.stopPropagation(); sel.value = b.dataset.v; sel.dispatchEvent(new Event('change', { bubbles: true })); label(); closeMenu(); };
    };
    sel.addEventListener('change', label);
  }
}
function openSettings() {
  const c = S.status?.claude || {}; const m = S.models;
  $('#settings-in').innerHTML = `<h2>Settings</h2>
    <div class="row"><div>Claude account<small>${esc(c.email || 'unknown')} · ${esc(c.subscription || '')}</small></div><button class="btn ghost sm" id="st-relogin">Re-login</button></div>
    ${PROVS.map(([v, n, ph, hint, docs]) => `<div class="row"><div>${n} key<small>${S.config.keys?.[v] ? (v === 'piapi' ? 'Stored in your user folder (owner-only). Never shown. Video clips (Seedance 2.5) render with it.' : 'Stored in your user folder (owner-only). Never shown.') : v === 'elevenlabs' ? 'Not set. GPT Image 2 needs it (and Seedance video when there is no PiAPI key).' : v === 'piapi' ? 'Not set. Video clips render through ElevenLabs instead while it is missing.' : 'Not set.'}${docs ? ` <button class="lnk" data-stdocs="${v}">Docs</button>` : ''}</small></div><div style="display:flex;gap:6px"><button class="btn ghost sm" data-stkey="${v}">${S.config.keys?.[v] ? 'Replace' : 'Add key'}</button>${S.config.keys?.[v] ? `<button class="btn ghost sm" data-stkey-rm="${v}">Remove</button>` : ''}</div></div>`).join('')}
    ${PROVS.filter(([v]) => v !== 'elevenlabs' && S.config.keys?.[v]).map(([v, n]) => `<div class="row"><div>${n} balance<small>${v === 'fal' ? 'fal shows a live balance only to admin-scope keys. Otherwise type your balance in USD and it counts down per render.' : v === 'piapi' ? 'PiAPI reports the balance live when the key verifies (shown here after a check). If it cannot, type your balance in USD and clips count it down.' : 'Higgsfield has no balance API. Type your credits once; renders count it down using the estimate Higgsfield gives for each render.'}${v === 'piapi' ? ' <span id="st-piapi-live"></span>' : ''}</small></div><input data-balance="${v}" type="number" min="0" step="${v === 'fal' || v === 'piapi' ? '0.01' : '1'}" value="${esc(String(S.config.balances?.[v]?.start ?? ''))}" placeholder="${v === 'fal' || v === 'piapi' ? 'USD' : 'credits'}" style="background:var(--fill-5);border:0;border-radius:8px;height:32px;padding:0 10px;outline:none;width:120px;color:var(--fg)"></div>`).join('')}
    <div class="row"><div>Chat History panel<small>Open the side panel by itself when a render starts. You can always open it from the top-right button.</small></div><select id="st-cvauto" class="prov"><option value="1" ${S.config.cvAuto !== false ? 'selected' : ''}>Opens automatically</option><option value="0" ${S.config.cvAuto === false ? 'selected' : ''}>Only when I open it</option></select></div>
    <div class="row"><div>Video provider<small>Which key renders video clips. Auto = PiAPI when its key is stored, else ElevenLabs (Seedance on its Image & Video API; Kling is not offered there).</small></div><select id="st-video" class="prov"><option value="auto" ${(S.config.videoProvider || 'auto') === 'auto' ? 'selected' : ''}>Auto${S.config.videoProviderActive ? ` (${VIDEO_PROV_NAME[S.config.videoProviderActive]} now)` : ' (no video key)'}</option><option value="piapi" ${S.config.videoProvider === 'piapi' ? 'selected' : ''}>PiAPI${S.config.keys?.piapi ? '' : ' (no key)'}</option><option value="elevenlabs" ${S.config.videoProvider === 'elevenlabs' ? 'selected' : ''}>ElevenLabs${S.config.keys?.elevenlabs ? '' : ' (no key)'}</option></select></div>
    <div class="row"><div>Key priority<small>Which provider new chats render images with. Each chat can switch in its composer.</small></div><select id="st-provider" class="prov">${IMAGE_PROVS.map(([v, n]) => `<option value="${v}" ${v === (S.config.provider || 'elevenlabs') ? 'selected' : ''}>${n}${S.config.keys?.[v] ? '' : ' (no key)'}</option>`).join('')}</select></div>
    <div class="row"><div>Your name<small>Used in the greeting</small></div><input id="st-name" value="${esc(S.config.name || '')}" placeholder="Albert Leo" style="background:var(--fill-5);border:0;border-radius:8px;height:32px;padding:0 10px;outline:none;width:180px"></div>
    <div class="row"><div>Default model</div><select id="st-model" style="background:var(--fill-5);color:var(--fg);border:0;border-radius:8px;height:32px;padding:0 8px">${m.map((x) => `<option value="${esc(x.value)}" ${x.value === S.config.model ? 'selected' : ''}>${esc(x.displayName)}</option>`).join('')}</select></div>
    <div class="row"><div>Default effort</div><select id="st-effort" style="background:var(--fill-5);color:var(--fg);border:0;border-radius:8px;height:32px;padding:0 8px">${EFFORTS.map(([v, n]) => `<option value="${v}" ${v === S.config.effort ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="row"><div>Pipeline folder<small class="v">${esc(S.config.pipelineRoot || '')}</small></div></div>
    <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" id="st-close">Close</button><button class="btn lime" id="st-save">Save</button></div>`;
  upgradeSelects($('#settings-in'));
  $('#settings').classList.add('on');
  $('#st-close').onclick = () => $('#settings').classList.remove('on');
  $('#st-save').onclick = async () => { const body = { name: $('#st-name').value, model: $('#st-model').value, effort: $('#st-effort').value, provider: $('#st-provider').value, videoProvider: $('#st-video').value, cvAuto: $('#st-cvauto').value === '1', balances: Object.fromEntries($$('[data-balance]').map((i) => [i.dataset.balance, i.value === '' ? null : Number(i.value)])) }; for (const p of Object.keys(body.balances)) if (body.balances[p] != null && S.config.balances?.[p]?.start === body.balances[p]) delete body.balances[p]; /* unchanged balances keep their start date */ S.config = { ...S.config, ...(await api('/api/settings', { method: 'POST', body })) }; $('#settings').classList.remove('on'); toast('Saved'); syncTriggers(); refreshCredits(); $('#home-title').textContent = `${S.config.name ? S.config.name.split(' ')[0] + ', what' : 'What'} are we creating today?`; $('#sb-name').firstChild.textContent = (S.config.name || c.email || 'Claude').split('@')[0]; };
  $('#st-relogin').onclick = async () => { await api('/api/login/open', { method: 'POST', body: {} }); toast('A terminal opened for the login.'); };
  for (const b of $$('[data-stdocs]')) b.onclick = () => openDocs(b.dataset.stdocs);
  if (S.config.keys?.piapi) api('/api/credits?provider=piapi').then((c) => { const el = $('#st-piapi-live'); if (el && c?.ok && c.balance != null && c.live) el.textContent = `Live balance: $${Number(c.balance).toFixed(2)}.`; }).catch(() => {});
  for (const b of $$('[data-stkey]')) b.onclick = () => { $('#settings').classList.remove('on'); sessionStorage.removeItem('sc-skip-key'); renderKeyGate(b.dataset.stkey); show('s-key'); };
  for (const b of $$('[data-stkey-rm]')) b.onclick = async () => { const p = b.dataset.stkeyRm; if (!confirm(`Remove the stored ${PROV_NAME[p]} key?`)) return; await api('/api/key?provider=' + p, { method: 'DELETE' }); S.config.keys = { ...(S.config.keys || {}), [p]: false }; S.config.hasKey = Object.values(S.config.keys).some(Boolean); openSettings(); syncTriggers(); refreshCredits(); };
}

// ---------------------------------------------------------------- docs (how to get a key)
const DOCS = {
  piapi: {
    title: 'PiAPI key for video',
    intro: 'Supercomputer renders video clips as Seedance 2.5 through PiAPI. PiAPI is pay as you go: no subscription, you top up a balance and each clip is billed per second of output.',
    steps: [
      { h: 'Sign in to the PiAPI workspace', p: 'Open the workspace and sign in with GitHub or an email address. A new account starts with about $0.50 of free credit, which is not enough for one clip.', code: 'https://piapi.ai/workspace' },
      { h: 'Copy your API key', p: 'In the left menu open API Key. The key is shown on that page; copy it. It looks like a long string of letters and numbers.', code: 'https://piapi.ai/workspace/key' },
      { h: 'Top up the balance', p: 'Open Billing and add funds (card). Seedance 2.5 costs per second of output, so a 6 second clip is about:', table: [['480p', '$0.15 / s', '$0.90'], ['720p', '$0.35 / s', '$2.10'], ['1080p', '$0.80 / s', '$4.80']], code: 'https://piapi.ai/workspace/billing' },
      { h: 'Paste the key in Supercomputer', p: 'Settings > PiAPI key > Add key, paste, Verify. The key is stored in your user folder with owner-only permissions and handed to the pipeline as an environment variable. It is never shown again and never sent to a chat.' },
      { h: 'Optional: keep it in the key file too', p: 'If the pipeline is also driven from a terminal, put the same key in API-KEYS.local.md (or .env) on its own line. Then the Use the key from API-KEYS.local.md button on the key screen imports it.', code: 'PIAPI_API_KEY=paste-your-key-here' },
      { h: 'Check it from a terminal (optional)', p: 'This asks PiAPI for the account balance and costs nothing. Replace the placeholder with the key.', code: 'curl -s https://api.piapi.ai/account/info -H "x-api-key: paste-your-key-here"' },
    ],
    notes: [
      'PiAPI offers Seedance 2.5 at 480p, 720p or 1080p, 4 to 30 seconds, aspect 21:9, 16:9, 4:3, 1:1, 3:4 or 9:16. There is no 2K or 4K; a job that asks for them renders at 1080p.',
      'Every clip stops here for approval first; you can change the resolution, seconds, aspect and sound before it runs. A failed clip is refunded by PiAPI.',
      'The reference sheets have to be reachable by PiAPI. With a PiAPI Creator plan or above they go through PiAPI\u2019s own temporary upload; on the free plan the app uses a public 24 hour temp host (litterbox.catbox.moe) instead.',
      'Rendering is slower at PiAPI\u2019s peak hours, 09:00 to 15:00 GMT (17:00 to 23:00 in Manila).',
    ],
  },
};
function openDocs(which) {
  const d = DOCS[which]; if (!d) return;
  const code = (c) => `<div class="doc-code"><code>${esc(c)}</code><button class="ct" type="button" title="Copy">${icon('copy')}<span>Copy</span></button></div>`;
  $('#docs-in').innerHTML = `<h2>${esc(d.title)}</h2><p class="doc-intro">${esc(d.intro)}</p>
    <ol class="doc-steps">${d.steps.map((st) => `<li><b>${esc(st.h)}</b><p>${esc(st.p)}</p>${st.table ? `<table class="doc-table"><tr><th>Resolution</th><th>Price</th><th>6 s clip</th></tr>${st.table.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : ''}${st.code ? code(st.code) : ''}</li>`).join('')}</ol>
    <div class="doc-notes">${d.notes.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
    <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn lime" id="docs-close">Close</button></div>`;
  mountIcons($('#docs-in'));
  for (const b of $$('#docs-in .doc-code .ct')) b.onclick = () => { navigator.clipboard.writeText(b.previousElementSibling.textContent); toast('Copied'); };
  $('#docs').classList.add('on');
  // closes from any screen (the key screen has no Esc handler of its own)
  const close = () => { $('#docs').classList.remove('on'); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape' && $('#docs').classList.contains('on')) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  $('#docs-close').onclick = close;
}

// ---------------------------------------------------------------- tiny markdown
// ---------------------------------------------------------------- paths as short links, prompts as editable boxes
// A path in chat is shown as the thing it is (character-01 v2, scene-01 still v3 prompt, brief, a job folder), never
// the C:\Users\... flood. Clicking opens it: media in the lightbox, a prompt or note in the Inspect panel, anything
// else with its own app, a folder in Explorer.
function pipelineRoot() { return (S.config?.pipelineRoot || '').replace(/[\\/]+$/, ''); }
function absPath(p) { return /^[A-Za-z]:/.test(p) ? p : `${pipelineRoot()}\\${String(p).replace(/^[\\/]+/, '').replace(/\//g, '\\')}`; }
function pathLabel(p) {
  const s = String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const job = s.match(/(?:^|\/)jobs\/([^/]+)(?:\/(.*))?$/);
  if (job) {
    if (!job[2]) return job[1];
    const rest = job[2].replace(/^(sheets|scenes|plan|frames|refs|references|renders|video)\//, '');
    const isPrompt = /\.prompt\.(txt|md)$/i.test(rest); const isDir = !/\.[a-z0-9]{1,5}$/i.test(rest);
    const core = rest.replace(/\.prompt\.(txt|md)$/i, '').replace(/\.[a-z0-9]{1,5}$/i, '');
    // the clip files are named previz-vN on disk; in the app the thing is called Blender (scene-01 Blender v1)
    return core.split('/').join(' ').replace(/-(v\d+)\b/g, ' $1').replace(/\bpreviz\b/g, 'Blender') + (isPrompt ? ' prompt' : isDir ? ' folder' : '');
  }
  const brief = s.match(/(?:^|\/)briefs\/(.+?)(\.md)?$/); if (brief) return brief[1].split('/').join(' ') + ' brief';
  return s.split('/').pop();
}
let pathRe = null;
function linkPaths(s) {
  if (!pathRe) {
    const q = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const root = pipelineRoot();
    const abs = String.raw`[A-Za-z]:\\(?:[^\\/<>|*?:\n"]+\\)*[^\\/<>|*?:\n"]+?\.[A-Za-z0-9]{1,5}(?=[\s.,;:)<]|$)`;
    const dir = root ? '|' + q(root) + String.raw`(?:\\[^\s\\/<>|*?:"']+)+` : '';
    const rel = String.raw`|(?<=^|[\s(>])(?:jobs|briefs)/[^\s<>|*?:"')]+`;
    pathRe = new RegExp(abs + dir + rel, 'g');
  }
  const root = pipelineRoot().toLowerCase();
  return s.replace(pathRe, (m) => {
    let path = m.replace(/[.,;:)]+$/, '');
    // job folders never contain spaces: a space after the pipeline root means the sentence continued
    if (root && path.toLowerCase().startsWith(root)) { const i = path.indexOf(' ', root.length); if (i > 0) path = path.slice(0, i).replace(/[.,;:)]+$/, ''); }
    const tail = m.slice(path.length);
    const a = absPath(path);
    const kind = /\.(png|jpg|jpeg|webp|gif|mp4|webm)$/i.test(path) ? 'media' : /\.(txt|md)$/i.test(path) ? 'text' : /\.[a-z0-9]{1,5}$/i.test(path) ? 'file' : 'dir';
    return `<a class="path ${kind}" href="#" data-path="${esc(a)}" title="${esc(a)}">${esc(pathLabel(path))}</a>${tail}`;
  });
}
function wireText(node) {
  for (const a of node.querySelectorAll('a[data-path]')) a.onclick = (e) => { e.preventDefault(); openPath(a.dataset.path, a.classList); };
  for (const box of node.querySelectorAll('.codebox')) {
    const code = box.querySelector('code');
    box.querySelector('.ct-copy').onclick = () => { navigator.clipboard.writeText(code.textContent); toast('Copied'); };
    const ins = box.querySelector('.ct-inspect'); if (ins) ins.onclick = () => showInspect({ path: box.dataset.path || '', label: box.dataset.label || 'Prompt', text: code.textContent });
  }
}
function openPath(p, cls) {
  if (cls.contains('media')) return lightbox(fileUrl(p), p);
  if (cls.contains('text')) return api('/api/prompt?path=' + encodeURIComponent(p)).then((r) => showInspect({ path: p, label: pathLabel(p), text: r.text || '' })).catch(() => toast('Could not read that file.', true));
  api('/api/open-folder', { method: 'POST', body: { path: p, open: cls.contains('file') } }).catch(() => toast('Could not open that.', true));
}

function md(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n'); let out = ''; let i = 0;
  const inline = (s) => {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:)!?]|$)/g, '$1<em>$2</em>'); // word-internal underscores (soda_can) stay literal
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = linkPaths(s);
    return s;
  };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      // ```prompt <path> marks a prompt the user may copy or change: the box gets Copy and a lime Inspect button.
      const info = l.replace(/^```\s*/, '').trim(); let j = i + 1, code = []; while (j < lines.length && !/^```/.test(lines[j])) code.push(lines[j++]);
      const pm = info.match(/^prompt(?:\s+(.+))?$/i); const p = pm ? (pm[1] || '').trim().replace(/^["'`]|["'`]$/g, '') : '';
      const label = pm ? (p ? pathLabel(p) : 'Prompt') : (info.split(/\s+/)[0] || 'Code');
      const absP = p ? absPath(p) : '';
      out += `<div class="codebox${pm ? ' prompt' : ''}" data-path="${esc(absP)}" data-label="${esc(label)}"><div class="code-tools"><span class="lbl">${esc(label)}</span><button class="ct ct-copy" type="button">${icon('copy')}Copy</button>${pm ? `<button class="ct ct-inspect" type="button">${icon('edit')}Inspect</button>` : ''}</div><pre><code>${esc(code.join('\n'))}</code></pre></div>`;
      i = j + 1; continue;
    }
    const hm = l.match(/^(#{1,3})\s+(.*)/); if (hm) { out += `<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`; i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { out += '<hr>'; i++; continue; }
    if (/^\s*[-*]\s+/.test(l)) { let items = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, '')); out += `<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`; continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { let items = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, '')); out += `<ol>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`; continue; }
    if (/^\|/.test(l) && /^\|/.test(lines[i + 1] || '') ) { let rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]); const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()); const head = cells(rows[0]); const body = rows.slice(1).filter((r) => !/^\|?\s*:?-{2,}/.test(r)); out += `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; continue; }
    if (/^>\s?/.test(l)) { let q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, '')); out += `<blockquote>${inline(q.join(' '))}</blockquote>`; continue; }
    if (!l.trim()) { i++; continue; }
    let p = [l]; i++; while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|\s*[-*]\s|\s*\d+[.)]\s|\||>)/.test(lines[i])) p.push(lines[i++]);
    out += `<p>${p.map(inline).join('<br>')}</p>`;
  }
  return out;
}

boot();
